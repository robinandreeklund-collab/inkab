import type { LibraryDocument } from "./machineSchema";
import type { Machine } from "./types";

/**
 * Demo-paketet: biblioteket och modellerna som filer att committa.
 *
 * En server utan DATABASE_URL håller uppladdade GLB:er i minnet, och minnet
 * dör med processen — på Renders gratisplan varje gång instansen somnat en
 * kvart. Repot är den enda lagring som överlever det, så paketet gör om det
 * som laddats upp till just repofiler: `data/library.json` som utgångsläge och
 * `public/models/*.glb` som statiskt innehåll. Maskinernas GLB-fält skrivs om
 * från `/api/models/<id>` till `/models/<fil>.glb` på vägen, så att biblioteket
 * pekar på filerna i paketet och inte på ett minne som inte finns kvar.
 */

/** En modellhänvisning som pekar in i modellagret, inte på en repofil. */
const STORED_MODEL = /^\/api\/models\/([^/?#]+)$/;

export type BundleFile = { path: string; modelId: string };

export type BundleMiss = {
  modelId: string;
  machineId: string;
  /** Maskinens namn, eller maskinen och varianten. */
  where: string;
};

export type BundlePlan = {
  /** Dokumentet med omskrivna modellsökvägar — det som blir data/library.json. */
  document: LibraryDocument;
  /** Modellfilerna som ska med, i arkivets sökvägar. */
  files: BundleFile[];
  /** Hänvisningar till modeller som inte finns kvar i lagret. */
  missing: BundleMiss[];
  /** Hänvisningar som redan pekar på repofiler eller externa adresser. */
  alreadyInRepo: number;
  /** Produktbilderna, som alltid följer med inbakade i biblioteksfilen. */
  assets: { count: number; bytes: number };
};

function slug(value: string): string {
  return (
    value
      // å, ä och ö är vanliga i variantnamn och hör inte hemma i ett filnamn
      // som ska överleva en resa genom git, ett zip-arkiv och en webbserver.
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "modell"
  );
}

function modelsOf(document: LibraryDocument): { glb: string; proxy?: string }[] {
  const models: { glb: string; proxy?: string }[] = [];
  for (const machine of document.machines as Machine[]) {
    if (machine.model) models.push(machine.model);
    for (const variant of machine.variants ?? []) if (variant.model) models.push(variant.model);
  }
  return models;
}

/**
 * Modell-id:n som biblioteket pekar på i lagret.
 *
 * Rutten läser dem innan den planerar: en modell som hunnit falla ur minnet
 * mellan listningen och läsningen ska räknas som saknad, inte skrivas om till
 * en fil som aldrig hamnar i arkivet.
 */
export function referencedModelIds(document: LibraryDocument): string[] {
  const ids = new Set<string>();
  for (const model of modelsOf(document)) {
    for (const field of ["glb", "proxy"] as const) {
      const url = model[field];
      const match = url ? STORED_MODEL.exec(url) : null;
      if (match) ids.add(decodeURIComponent(match[1]));
    }
  }
  return [...ids];
}

/**
 * Bygger paketets innehåll ur ett bibliotek och de modell-id som finns kvar i
 * lagret. Ren funktion: den läser inga filer och skriver inget, så den går att
 * provköra på vilket bibliotek som helst.
 */
export function planDemoBundle(document: LibraryDocument, available: Set<string>): BundlePlan {
  const doc: LibraryDocument = JSON.parse(JSON.stringify(document));
  const files: BundleFile[] = [];
  const missing: BundleMiss[] = [];
  /** Samma modell kan sitta på flera maskiner — den ska bli en fil. */
  const pathForModel = new Map<string, string>();
  const usedPaths = new Set<string>();
  let alreadyInRepo = 0;

  const fileName = (base: string, proxy: boolean): string => {
    const suffix = proxy ? ".proxy.glb" : ".glb";
    let candidate = `public/models/${base}${suffix}`;
    let n = 2;
    while (usedPaths.has(candidate)) candidate = `public/models/${base}-${n++}${suffix}`;
    usedPaths.add(candidate);
    return candidate;
  };

  const rewrite = (
    model: { glb: string; proxy?: string } | undefined,
    base: string,
    where: string,
    machineId: string,
  ) => {
    if (!model) return;

    for (const field of ["glb", "proxy"] as const) {
      const url = model[field];
      if (!url) continue;

      const match = STORED_MODEL.exec(url);
      if (!match) {
        // Pekar redan på /models/… eller på en adress utanför appen.
        alreadyInRepo++;
        continue;
      }

      const modelId = decodeURIComponent(match[1]);
      const known = pathForModel.get(modelId);
      if (known) {
        model[field] = known.replace(/^public/, "");
        continue;
      }

      if (!available.has(modelId)) {
        // Filen är borta ur lagret — sökvägen lämnas orörd så att vyn Modell
        // säger till som vanligt i stället för att peka på en fil som saknas.
        missing.push({ modelId, machineId, where });
        continue;
      }

      const path = fileName(base, field === "proxy");
      pathForModel.set(modelId, path);
      files.push({ path, modelId });
      model[field] = path.replace(/^public/, "");
    }
  };

  for (const machine of doc.machines as Machine[]) {
    rewrite(machine.model, slug(machine.id), machine.name || machine.id, machine.id);
    for (const variant of machine.variants ?? []) {
      rewrite(
        variant.model,
        `${slug(machine.id)}-${slug(variant.id)}`,
        `${machine.name || machine.id} – ${variant.name || variant.id}`,
        machine.id,
      );
    }
  }

  // Bilderna behöver ingen omskrivning: de ligger som base64 i dokumentet och
  // följer med biblioteksfilen av sig själva. Räknas ändå, så att paketet kan
  // säga att de är med i stället för att lämna frågan öppen.
  const assets = {
    count: doc.assets?.length ?? 0,
    // Base64 är fyra tecken per tre byte.
    bytes: Math.round((doc.assets ?? []).reduce((sum, a) => sum + a.data.length, 0) * 0.75),
  };

  return { document: doc, files, missing, alreadyInRepo, assets };
}

const KB = 1024;

function size(bytes: number): string {
  if (bytes < 900 * KB) return `${Math.max(1, Math.round(bytes / KB))} kB`;
  return `${(bytes / KB / KB).toFixed(1).replace(".", ",")} MB`;
}

/** Instruktionen som ligger överst i arkivet. */
export function demoBundleReadme(
  plan: BundlePlan,
  sizes: Map<string, number>,
  now: Date,
): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const lines = [
    "# Demo-paket",
    "",
    `Skapat ${stamp} ur admin-vyn. Innehåller biblioteket och de uppladdade`,
    "3D-modellerna som filer att lägga i repot, så att demon ser likadan ut",
    "efter varje omstart och varje deploy — utan databas.",
    "",
    "## Så här lägger du in det",
    "",
    "1. Packa upp arkivet i reporoten. `data/` och `public/models/` hamnar rätt av sig själva.",
    "2. `git add data public/models`",
    '3. `git commit -m "Uppdaterat maskinbibliotek och modeller"`',
    "4. `git push` — Render bygger om och läser `data/library.json` vid varje start.",
    "",
    "Skriv inte över `public/models/README.md`; den hör till repot.",
    "",
    "## Innehåll",
    "",
    "| Fil | Vad |",
    "|---|---|",
    "| `data/library.json` | Maskiner, prisbok, produktbilder och prisinställningar. Läses som utgångsläge vid varje start. |",
  ];

  for (const file of plan.files) {
    const bytes = sizes.get(file.modelId) ?? 0;
    lines.push(`| \`${file.path}\` | 3D-modell, ${size(bytes)}. |`);
  }

  lines.push(
    "",
    `Maskinernas GLB-fält är omskrivna från \`/api/models/…\` till \`/models/…\`, så`,
    "biblioteket pekar på filerna ovan i stället för på serverns minne.",
  );

  if (plan.assets.count > 0) {
    lines.push(
      "",
      plan.assets.count === 1
        ? `Produktbilden (${size(plan.assets.bytes)}) ligger inbakad i`
        : `Produktbilderna — ${plan.assets.count} stycken, ${size(plan.assets.bytes)} — ligger inbakade i`,
      "`data/library.json` och behöver ingen egen fil. De följer med committen",
      "och finns kvar efter omstart, precis som modellerna.",
    );
  }

  if (plan.alreadyInRepo > 0) {
    lines.push(
      "",
      `${plan.alreadyInRepo} modellhänvisning${plan.alreadyInRepo === 1 ? "" : "ar"} pekade redan`,
      "på en repofil eller en extern adress och lämnades orörd.",
    );
  }

  if (plan.missing.length > 0) {
    lines.push(
      "",
      "## Modeller som saknas",
      "",
      "De här maskinerna pekar på modeller som inte finns kvar i serverns minne —",
      "de laddades upp före den senaste omstarten. Ladda upp STEP-filen igen i",
      "admin-vyn och exportera ett nytt paket, så kommer de med.",
      "",
    );
    for (const miss of plan.missing) lines.push(`- ${miss.where} (\`${miss.modelId}\`)`);
  }

  lines.push(
    "",
    "## Vad som inte är med",
    "",
    "Konton, sparade offerter och maskinernas underlag (ritningar, STEP-filer,",
    "skärfiler) ligger också bara i minnet utan databas, men hör inte hemma i",
    "git — underlagen är tiotals megabyte styck. Ska de överleva omstarter",
    "behövs en riktig databas: sätt `DATABASE_URL`.",
    "",
  );

  return lines.join("\n");
}

/** Filnamnet nedladdningen får. */
export function bundleFileName(now: Date): string {
  return `inkab-demo-${now.toISOString().slice(0, 10)}.zip`;
}
