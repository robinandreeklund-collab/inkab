#!/usr/bin/env node
/**
 * STEP in, maskinpaket ut.  Användning: node scripts/maskinpaket.mjs --hjalp
 *
 * Skillnaden mot step-to-glb.mjs: det skriptet ger en GLB och ett katalogkort
 * och lämnar resten åt admin-vyn. Det här ger en färdig mapp per maskin —
 * modellen, maskinposten och en lapp om vad som är gissat — som går att
 * lägga i repot och committa. Konverteringen är densamma; båda anropar
 * src/lib/cad/stepConvert.ts, så det finns bara en tessellering att underhålla.
 *
 * Två steg, och det är med flit. Första körningen mäter upp maskinen och
 * skriver ett paket med nollor i allt en CAD-fil inte kan svara på. Sedan
 * fyller man i dem i maskin.json — kategori, kapacitet, effekt, leveranstid —
 * och kör installationen. Att lägga nollorna rakt in i biblioteket vore att
 * skicka in halvfärdig data och hoppas att någon minns att rätta den.
 *
 * Ingen del av det här pratar med plattformen: ingen server, ingen admin-vy,
 * ingen databas. Det är en filkonvertering på den egna datorn.
 */

import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Konverteringen ligger i TypeScript som admin-vyns web worker också använder.
 * Node kör den med --experimental-strip-types; saknas flaggan startar skriptet
 * om sig självt med den, så att `node scripts/maskinpaket.mjs` räcker.
 *
 * Heapen sätts om av samma skäl som filen körs här i stället för i webbläsaren:
 * en tung sammanställning håller hundratals megabyte trianglar samtidigt.
 * Taket är ett tak, inte en reservation.
 */
const HJALP = `
STEP in, maskinpaket ut.

  node scripts/maskinpaket.mjs                        Läser ./step-in, skriver ./maskiner
  node scripts/maskinpaket.mjs <mapp|fil ...>         Någon annan inmapp
  node scripts/maskinpaket.mjs maskiner --installera  Lägger färdiga paket i repot

Två steg, med flit. Första körningen mäter upp maskinen ur CAD-filen och
skriver ett paket där allt den inte kan veta står på noll. Fyll i dem i
maskin.json — kategori, kapacitet, effekt, leveranstid — och kör sedan
installationen.

En mapp per maskin:
  <id>/<id>.glb      modellen, redan rätt namngiven
  <id>/maskin.json   maskinposten, prövad mot samma schema som servern
  <id>/kort.json     mätt fotavtryck, riktning, statistik och varningar
  <id>/LÄSMIG.txt    vad som är mätt och vad som är gissat

Flaggor
  --ut <mapp>            Vart paketen skrivs (standard: ./maskiner)
  --installera           Kopiera in i repot: GLB:n till public/models och
                         maskinposten till data/library.json
  --ersatt               Låt --installera skriva över en maskin som finns
  --repo <mapp>          Vilket repo --installera skriver till
  --riktning <z|y>       Vilken axel som är upp i CAD-filen
  --vrid <0|90|180|270>  Vridning kring upp-axeln
  --tolerans <mm>        Kordatolerans vid tessellering (standard 2). Största
                         spaken för filstorlek.
  --minsta-del <mm>      Utelämna delar mindre än detta (standard 50)
  --heap <MB>            Tak för Nodes JS-heap (standard 8192)
  --tyst
`;

if (
  process.argv.slice(2).some((a) => ["--hjalp", "--help", "-h"].includes(a))
) {
  console.log(HJALP.trim());
  process.exit(0);
}

const REQUIRED_FLAGS = ["--experimental-strip-types"];
const HEAP_FLAG = "--max-old-space-size";

const heapArg = process.argv.indexOf("--heap");
const heapMb = heapArg > -1 ? Number(process.argv[heapArg + 1]) : 8192;
const heapSet =
  process.execArgv.some((a) => a.startsWith(HEAP_FLAG)) ||
  (process.env.NODE_OPTIONS ?? "").includes(HEAP_FLAG);

const missing = [
  ...REQUIRED_FLAGS.filter((flag) => !process.execArgv.includes(flag)),
  ...(heapSet ? [] : [`${HEAP_FLAG}=${heapMb}`]),
];
if (missing.length > 0) {
  const self = fileURLToPath(import.meta.url);
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, ...missing, self, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
  );
  process.exit(child.status ?? 1);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => path.join(ROOT, "src", p);

const { convertStep, suggestPorts } = await import(
  src("lib/cad/stepConvert.ts")
);
const { measureGlb } = await import(src("lib/cad/measureGlb.ts"));
const { surveyStepText, tooManyParts } = await import(
  src("lib/cad/stepSurvey.ts")
);
const { convertStepNative, findNativeConverter, NATIVE_SETUP, optimiseGlb } =
  await import(src("lib/cad/nativeConvert.ts"));
const { DEFAULT_ORIENTATION, orientedFootprint, orientationLabel } =
  await import(src("lib/cad/orientation.ts"));
const { machineSchema, libraryDocumentSchema } = await import(
  src("lib/machineSchema.ts")
);

/* ── Argument ──────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = {
    ut: "maskiner",
    tolerans: 2,
    minstaDel: 50,
    inputs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ut") args.ut = argv[++i];
    else if (a === "--installera") args.installera = true;
    else if (a === "--ersatt") args.ersatt = true;
    else if (a === "--tvinga") args.tvinga = true;
    else if (a === "--wasm") args.wasm = true;
    else if (a === "--python") args.python = argv[++i];
    else if (a === "--repo") args.repo = argv[++i];
    else if (a === "--riktning") args.riktning = argv[++i];
    else if (a === "--vrid") args.vrid = Number(argv[++i]);
    else if (a === "--tolerans") args.tolerans = Number(argv[++i]);
    else if (a === "--minsta-del") args.minstaDel = Number(argv[++i]);
    else if (a === "--heap")
      i++; // läses före omstarten
    else if (a === "--tyst") args.tyst = true;
    else if (a.startsWith("--")) {
      console.error(`Okänd flagga: ${a}`);
      process.exit(1);
    } else args.inputs.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const log = (...m) => !args.tyst && console.log(...m);

/* ── Riktning ──────────────────────────────────────────────────────────── */

/**
 * Hur CAD-filerna är vända.
 *
 * Riktningen hör till CAD-systemet, inte till maskinen, så den står på
 * biblioteket och inte per fil. Finns den där används den; annars husets
 * utgångsläge. Flaggorna går före båda.
 */
async function orientation() {
  let base = DEFAULT_ORIENTATION;
  try {
    const doc = JSON.parse(
      await readFile(path.join(ROOT, "data", "library.json"), "utf-8"),
    );
    if (doc.modelDefaults) base = doc.modelDefaults;
  } catch {
    // Inget bibliotek att fråga — husets utgångsläge duger.
  }
  return {
    ...base,
    ...(args.riktning ? { upAxis: args.riktning } : {}),
    ...(args.vrid != null ? { yawDeg: args.vrid } : {}),
  };
}

const RIKTNING = await orientation();

/* ── Vilka filer ───────────────────────────────────────────────────────── */

const STANDARD_IN = "step-in";
const isStep = (name) => /\.(stp|step)$/i.test(name);
/**
 * Färdiga modeller tas emot också. En sammanställning med tiotusentals delar
 * går över STEP-läsarens 2 GB-tak, och taket sitter i WASM-bygget — det går
 * inte att höja genom att köra någon annanstans. Då konverteras filen nativt
 * och mäts här.
 */
const isGlb = (name) => /\.glb$/i.test(name) && !/\.proxy\.glb$/i.test(name);
const kanLasas = (name) => isStep(name) || isGlb(name);
const finns = (p) =>
  stat(p)
    .then(() => true)
    .catch(() => false);

/**
 * Vad som pekades ut: STEP-filer att konvertera, eller paket som redan är
 * gjorda.
 *
 * En mapp med en maskin.json i är ett paket. En mapp med sådana mappar i är
 * en hög paket. Allt annat letas igenom efter STEP-filer. Det är så samma
 * kommando duger till båda stegen: först konvertera, sedan — när nollorna är
 * ifyllda — installera.
 */
async function gather(inputs) {
  const steps = [];
  const paket = [];
  for (const input of inputs) {
    const info = await stat(input).catch(() => null);
    if (!info) {
      console.error(`Hittar inte ${input}`);
      process.exit(1);
    }
    if (!info.isDirectory()) {
      steps.push(input);
      continue;
    }
    if (await finns(path.join(input, "maskin.json"))) {
      paket.push(input);
      continue;
    }
    const entries = await readdir(input, { withFileTypes: true });
    let hittat = 0;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(input, entry.name);
      if (entry.isFile() && kanLasas(entry.name)) {
        steps.push(p);
        hittat++;
      } else if (
        entry.isDirectory() &&
        (await finns(path.join(p, "maskin.json")))
      ) {
        paket.push(p);
        hittat++;
      }
    }
    if (hittat === 0)
      console.error(`Varken STEP-filer eller maskinpaket i ${input}`);
  }
  return { steps, paket };
}

/**
 * Modellen i ett paket.
 *
 * Normalt <id>.glb, men id:t kan ha bytts i maskin.json efter konverteringen.
 * Då gäller namnet i model.glb, och i sista hand den enda GLB som ligger där.
 */
async function glbIPaketet(mapp, maskin) {
  const kandidater = [
    `${maskin.id}.glb`,
    maskin.model?.glb ? path.basename(maskin.model.glb) : null,
  ].filter(Boolean);
  for (const namn of kandidater) {
    const p = path.join(mapp, namn);
    if (await finns(p)) return p;
  }
  const kvar = (await readdir(mapp)).filter((n) =>
    n.toLowerCase().endsWith(".glb"),
  );
  return kvar.length === 1 ? path.join(mapp, kvar[0]) : null;
}

/** Läser ett färdigt paket och prövar maskinposten mot schemat. */
async function lasPaket(mapp) {
  const maskin = JSON.parse(
    await readFile(path.join(mapp, "maskin.json"), "utf-8"),
  );
  const provad = machineSchema.safeParse(maskin);
  const fel = provad.success
    ? []
    : provad.error.issues.map(
        (i) => `${i.path.join(".") || "(roten)"}: ${i.message}`,
      );
  return { id: maskin.id, mapp, maskin, ok: fel.length === 0, fel };
}

let inputs = args.inputs;
if (inputs.length === 0) {
  // Utan argument: standardmappen. Finns den inte skapas den, för det är
  // svaret på frågan "var lägger jag filerna?" — inte ett fel.
  const info = await stat(STANDARD_IN).catch(() => null);
  if (!info) {
    await mkdir(STANDARD_IN, { recursive: true });
    log(`Skapade mappen ${STANDARD_IN}/`);
    log("Lägg dina STEP-filer där och kör skriptet igen.");
    process.exit(0);
  }
  inputs = [STANDARD_IN];
}

const { steps: files, paket: fardiga } = await gather(inputs);
if (files.length === 0 && fardiga.length === 0) {
  log(`Inget att göra. Lägg STEP-filer i ${STANDARD_IN}/ och kör igen.`);
  process.exit(0);
}

/* ── Maskinposten ──────────────────────────────────────────────────────── */

/** Filnamn → maskin-id: gemener, bindestreck, inga diakriter. */
const slug = (file) =>
  path
    .basename(file)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Maskin-id → läsbart namn: "rullbana-underslag" blir "Rullbana underslag". */
const titel = (id) => {
  const ord = id.replace(/-/g, " ");
  return ord.charAt(0).toUpperCase() + ord.slice(1);
};

/**
 * Fälten en STEP-fil inte kan svara på.
 *
 * De står med nollor och gissningar, inte med påhittade värden som ser
 * rimliga ut. En kapacitet på 0 paket/h syns direkt i gränssnittet och i
 * offerten; en påhittad på 18 gör det inte, och då är det ingen som rättar
 * den. dimensionsVerified: false bär samma budskap till admin-vyn.
 */
const ATT_FYLLA_I = [
  ["sku", "Artikelnummer. Gissat ur filnamnet."],
  ["name", "Maskinens namn i katalogen. Gissat ur filnamnet."],
  [
    "category",
    "Kategori: infeed, stacking, stickers, transport, processing, finishing, outfeed, control. Gissat.",
  ],
  ["summary", "En rad om vad maskinen gör. Syns i katalogen."],
  [
    "ports",
    "Portarnas lägen och höjd. Förslaget ligger mitt på kortsidorna, 900 mm över golv.",
  ],
  ["capacity", "Paket/h, paketens mått och maxvikt. Står på noll."],
  ["utilities", "Effekt i kW och tryckluft i Nl/min. Står på noll."],
  ["foundation", "Gropdjup och punktlast. Står på noll."],
  ["leadTimeWeeks", "Leveranstid i veckor. Står på noll."],
  [
    "pris",
    "Pris och självkostnad. Utan dem räknas maskinen som 0 kr i offerten.",
  ],
];

function maskinpost(id, footprint, ports, glbUrl) {
  return {
    id,
    sku: id.toUpperCase().slice(0, 40),
    name: titel(id),
    category: "transport",
    summary: "",
    footprint,
    ports,
    mirrorable: false,
    zones: [],
    capacity: {
      packagesPerHour: 0,
      packageLengthMm: [0, 0],
      packageWidthMm: [0, 0],
      packageHeightMm: [0, 0],
      maxWeightKg: 0,
    },
    utilities: { powerKw: 0, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 0 },
    leadTimeWeeks: 0,
    options: [],
    model: { glb: glbUrl, ...RIKTNING },
    dimensionsVerified: false,
  };
}

const m = (v) => (v / 1000).toFixed(2).replace(".", ",");

function lasmig(id, maskin, kort, fel) {
  const rader = [
    `${maskin.name}  (${id})`,
    "",
    `Mått        ${m(maskin.footprint.lengthMm)} × ${m(maskin.footprint.widthMm)} × ` +
      `${m(maskin.footprint.heightMm)} m  (längd × bredd × höjd)`,
    `Riktning    ${orientationLabel(RIKTNING)}`,
    `Källa       ${kort.source}`,
    "",
    "Måtten är mätta ur CAD-filen och stämmer. Resten är gissat:",
    "",
    ...ATT_FYLLA_I.map(([fält, vad]) => `  ${fält.padEnd(14)}${vad}`),
    "",
    "Så kommer paketet in i verktyget:",
    "",
    `  1. Kopiera ${id}.glb till public/models/ i repot.`,
    "  2. Lägg maskin.json i machines-listan i data/library.json.",
    `  3. Lägg ett pris på "${id}" i priceBook.entries i samma fil.`,
    "  4. Committa och pusha.",
    "",
    `  Eller låt skriptet göra 1–3:  node scripts/maskinpaket.mjs ${args.ut} --installera`,
    "",
    "Kontrollera riktningen i 3D-vyn innan kund ser maskinen. Står den på",
    "högkant eller bakvänd är det CAD-systemets konvention som skiljer sig —",
    "vrid med --riktning och --vrid och kör om.",
  ];
  if (kort.warnings.length > 0) {
    rader.push("", "Varningar från konverteringen:", "");
    for (const w of kort.warnings) rader.push(`  - ${w}`);
  }
  if (fel.length > 0) {
    rader.push(
      "",
      "MASKINPOSTEN GODKÄNNS INTE AV SCHEMAT och går inte att lägga in som den är:",
      "",
    );
    for (const f of fel) rader.push(`  - ${f}`);
  }
  return rader.join("\n") + "\n";
}

/* ── Konvertera ────────────────────────────────────────────────────────── */

const tagna = new Set();

async function paketera(input) {
  let id = slug(input);
  // Två filer kan heta samma sak efter tvättning. Hellre ett nummer på den
  // andra än att den tyst skriver över den första.
  if (tagna.has(id)) {
    let n = 2;
    while (tagna.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  tagna.add(id);

  const bytes = new Uint8Array(await readFile(input));
  const redanGlb = isGlb(input);
  log(`\n${path.basename(input)}  ${(bytes.length / 1e6).toFixed(1)} MB`);

  /*
   * Räkna delarna först. Det tar en sekund och avgör om filen alls går att
   * läsa — förut kom samma besked efter tio minuters tessellering, som ett
   * minnesfel, och då hade man redan väntat.
   */
  /*
   * Vilken läsare som ska ta filen.
   *
   * Den nativa används när den finns. Den har inget 2 GB-tak, den är
   * snabbare, och den ger samma geometri — mätt på as1-oc-214, som båda
   * vägarna mäter till 0,08 × 0,20 × 0,15 m. WASM-läsaren är det som finns
   * utan extra installation, och därför reserven.
   *
   * Att välja på antalet delar vore att lita på en gissning som inte går
   * att lita på: en fil räknad till 849 delar i texten blev 87 012 i
   * läsaren. Gissningen får säga "den här är stor", inte avgöra vägen.
   */
  let nativ = null;
  if (!redanGlb) {
    const survey = surveyStepText(bytes);
    const minuter = Math.round(survey.estimatedSeconds / 60);
    log(
      `  Delar     minst ~${survey.estimatedParts.toLocaleString("sv-SE")}` +
        (survey.verdict === "ok"
          ? ""
          : `   beräknad tid ${minuter < 60 ? `${minuter} min` : `${Math.round(minuter / 60)} h`}`),
    );

    if (!args.wasm) nativ = await findNativeConverter(args.python);
    if (nativ) {
      log(`  Väg       nativ OpenCascade via ${nativ.command}`);
    } else {
      const stopp = tooManyParts(survey);
      if (stopp && !args.tvinga) {
        throw new Error(
          `${stopp}\n` +
            `             Installera den nativa vägen så tar skriptet den själv:  ${NATIVE_SETUP}\n` +
            "             (--tvinga försöker med den inbyggda läsaren ändå)",
        );
      }
      if (survey.verdict === "långsam") {
        log("  VARNING   Många delar. Det här tar en stund.");
      }
    }
  }

  const körNativt = async (verktyg) => {
    const rå = await convertStepNative(verktyg, input, {
      toleranceMm: args.tolerans,
      minPartMm: args.minstaDel,
      onStage: (stage) => log(`            ${stage}`),
    });
    log(
      `  Delar     ${rå.kept.toLocaleString("sv-SE")} behållna` +
        (rå.skipped
          ? `, ${rå.skipped.toLocaleString("sv-SE")} under ${args.minstaDel} mm överhoppade`
          : ""),
    );
    // Samma efterbehandling som den inbyggda vägen, annars blir filen
    // mångdubbelt större för samma geometri och 3D-vyn får betala det.
    const glb = await optimiseGlb(rå.glb);
    return { ...(await measureGlb(glb)), glb };
  };

  // En GLB är redan konverterad: den mäts och packas, den byggs inte om.
  let result;
  if (redanGlb) {
    result = { ...(await measureGlb(bytes)), glb: bytes };
  } else if (nativ) {
    result = await körNativt(nativ);
  } else {
    try {
      result = await convertStep(bytes, {
        toleranceMm: args.tolerans,
        minPartMm: args.minstaDel,
        up: "z",
      });
    } catch (error) {
      /*
       * Den inbyggda läsaren gav upp, och den nativa fanns inte — annars
       * hade filen aldrig kommit hit. Felet ska säga vad som gör att nästa
       * försök lyckas, inte bara vad som gick fel: gissningen på antalet
       * delar är bara en gissning, så hit kommer man även när filen såg
       * liten ut i texten.
       */
      const message = error instanceof Error ? error.message : String(error);
      // Bara när det är läsarens kapacitet som tog slut. "Sänk gränsen för
      // smådelar" är ett annat fel, och där hade den nativa läsaren gjort
      // exakt samma sak — att skicka iväg någon på en installation då vore
      // samma sorts felspår som --heap var.
      const slutKapacitet = /fick ingen geometri ur någon av dem/.test(message);
      throw new Error(
        slutKapacitet
          ? `${message}\n` +
              "             Den nativa läsaren har inget sådant tak och hade klarat filen.\n" +
              `             Installera den med:  ${NATIVE_SETUP}`
          : message,
      );
    }
  }

  /*
   * Fotavtrycket mäts på den ovridna geometrin. Biblioteket ska bära måtten
   * som maskinen får när den ritas upp, alltså efter riktningen — annars
   * klagar 3D-vyn på att modellen och biblioteket säger olika saker, och den
   * har rätt.
   */
  const matt = orientedFootprint(result.footprint, RIKTNING);
  const footprint = {
    lengthMm: Math.round(matt.lengthMm),
    widthMm: Math.round(matt.widthMm),
    heightMm: Math.round(matt.heightMm),
  };
  const ports = suggestPorts(footprint);

  const mapp = path.join(args.ut, id);
  await mkdir(mapp, { recursive: true });
  await writeFile(path.join(mapp, `${id}.glb`), result.glb);

  const maskin = maskinpost(id, footprint, ports, `/models/${id}.glb`);
  const provad = machineSchema.safeParse(maskin);
  const fel = provad.success
    ? []
    : provad.error.issues.map(
        (i) => `${i.path.join(".") || "(roten)"}: ${i.message}`,
      );

  const kort = {
    id,
    source: path.basename(input),
    sourceKind: redanGlb ? "glb" : nativ ? "step-nativ" : "step",
    generatedAt: new Date().toISOString(),
    /** Måtten som de står i CAD-filen, före riktningen. */
    measuredFootprint: result.footprint,
    orientation: RIKTNING,
    footprint,
    ports,
    stats: result.stats,
    warnings: result.warnings,
    schemaErrors: fel,
  };

  await writeFile(
    path.join(mapp, "maskin.json"),
    JSON.stringify(maskin, null, 2) + "\n",
  );
  await writeFile(
    path.join(mapp, "kort.json"),
    JSON.stringify(kort, null, 2) + "\n",
  );
  await writeFile(path.join(mapp, "LÄSMIG.txt"), lasmig(id, maskin, kort, fel));

  log(
    `  Mått      ${m(footprint.lengthMm)} × ${m(footprint.widthMm)} × ` +
      `${m(footprint.heightMm)} m   (${orientationLabel(RIKTNING)})`,
  );
  log(
    `  GLB       ${(result.glb.length / 1e6).toFixed(2)} MB` +
      (redanGlb || nativ
        ? `   ${result.stats.trianglesIn.toLocaleString("sv-SE")} trianglar${redanGlb ? "   (inläst, inte konverterad)" : ""}`
        : `   ${result.stats.partsKept} av ${result.stats.partsIn} delar` +
          `   ${result.stats.seconds} s`),
  );
  // Minnet är det som fäller en tung fil, så det syns när det börjar bli trångt.
  if (!redanGlb && !nativ && result.stats.readerMemoryMb >= 512) {
    log(
      `  Minne     ${result.stats.readerMemoryMb} MB av 2048 MB i STEP-läsaren`,
    );
  }
  log(`  Paket     ${mapp}/`);
  for (const w of result.warnings) log(`  VARNING   ${w}`);
  for (const f of fel) log(`  SCHEMAFEL ${f}`);

  return { id, mapp, maskin, ok: fel.length === 0 };
}

const klara = [];
const trasiga = [];

for (const input of files) {
  try {
    klara.push(await paketera(input));
  } catch (error) {
    // En trasig fil i en hög ska inte ta de andra med sig.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nMISSLYCKADES ${input}`);
    console.error(`             ${message}`);
    trasiga.push(input);
  }
}

// Paket som redan finns konverteras inte om; de läses bara in.
for (const mapp of fardiga) {
  try {
    const p = await lasPaket(mapp);
    klara.push(p);
    log(`\n${p.maskin.name}  (${p.id})   färdigt paket`);
    for (const f of p.fel) log(`  SCHEMAFEL ${f}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nMISSLYCKADES ${mapp}`);
    console.error(`             ${message}`);
    trasiga.push(mapp);
  }
}

/* ── Översikt ──────────────────────────────────────────────────────────── */

if (files.length > 0) {
  await mkdir(args.ut, { recursive: true });
  await writeFile(
    path.join(args.ut, "LÄSMIG.md"),
    [
      "# Maskinpaket",
      "",
      "En mapp per maskin, framtagen ur STEP-filerna med `scripts/maskinpaket.mjs`.",
      "",
      "Varje mapp innehåller:",
      "",
      "| Fil | Vad |",
      "| --- | --- |",
      "| `<id>.glb` | Modellen, rätt namngiven. Hör hemma i `public/models/`. |",
      "| `maskin.json` | Maskinposten. Hör hemma i `machines` i `data/library.json`. |",
      "| `kort.json` | Mätt fotavtryck, riktning, statistik och varningar. Spårbarhet. |",
      "| `LÄSMIG.txt` | Vad som är mätt och vad som är gissat. |",
      "",
      "Måtten är mätta ur CAD-filen och stämmer. Namn, kategori, kapacitet,",
      "effekt, fundament, leveranstid och pris kan en STEP-fil inte svara på —",
      "de står på noll tills någon fyller i dem. En nolla syns i gränssnittet;",
      "ett påhittat värde gör det inte, och då blir det kvar.",
      "",
      "## In i verktyget",
      "",
      "```sh",
      `node scripts/maskinpaket.mjs ${args.ut} --installera`,
      "```",
      "",
      "Kopierar GLB:n till `public/models/`, lägger maskinposten i",
      "`data/library.json` och ett nollpris i prisboken, och prövar hela",
      "biblioteket mot samma schema som servern innan filen skrivs. Sedan är det",
      "`git add` och `git push` som vanligt.",
      "",
      "Maskiner som redan finns rörs inte utan `--ersatt`.",
      "",
    ].join("\n"),
  );
}

log("");
if (files.length > 0) {
  const n = klara.length - fardiga.length;
  log(`Klart       ${n} maskin${n === 1 ? "" : "er"} i ${args.ut}/`);
}
if (trasiga.length > 0)
  log(`Misslyckades ${trasiga.length}: ${trasiga.join(", ")}`);

/* ── Installera i repot ────────────────────────────────────────────────── */

if (args.installera && klara.length > 0) {
  // Normalt det här repot. --repo pekar ut ett annat, för den som har
  // verktyget på ett ställe och checkouten på ett annat.
  const repo = args.repo ? path.resolve(args.repo) : ROOT;
  const biblioteket = path.join(repo, "data", "library.json");
  const doc = JSON.parse(await readFile(biblioteket, "utf-8"));
  const fanns = new Set(doc.machines.map((x) => x.id));

  const lagda = [];
  const hoppade = [];
  for (const { id, mapp, maskin, ok } of klara) {
    if (!ok) {
      hoppade.push(`${id} (godkänns inte av schemat)`);
      continue;
    }
    if (fanns.has(id) && !args.ersatt) {
      hoppade.push(`${id} (finns redan — kör med --ersatt)`);
      continue;
    }
    const kalla = await glbIPaketet(mapp, maskin);
    if (!kalla) {
      hoppade.push(`${id} (ingen GLB i paketet)`);
      continue;
    }
    await mkdir(path.join(repo, "public", "models"), { recursive: true });
    await copyFile(kalla, path.join(repo, "public", "models", `${id}.glb`));

    // Adressen är repots, inte paketets: filen ligger nu i public/models.
    const post = {
      ...maskin,
      model: { ...maskin.model, glb: `/models/${id}.glb` },
    };
    const i = doc.machines.findIndex((x) => x.id === id);
    if (i > -1) doc.machines[i] = post;
    else doc.machines.push(post);

    /*
     * Ett nollpris, inte inget pris. Prisräkningen hoppar tyst över en maskin
     * som saknar post i prisboken, och då står den i ritningen men inte i
     * offerten. En nolla står på båda ställena och går att se.
     */
    if (!doc.priceBook.entries[id]) {
      doc.priceBook.entries[id] = { list: 0, cost: 0, options: {} };
    }
    lagda.push(id);
  }

  if (lagda.length > 0) {
    // Hela biblioteket prövas, inte bara den nya posten: dubblerade id och
    // trasiga beroenden syns först när allt ligger i samma dokument.
    const provat = libraryDocumentSchema.safeParse(doc);
    if (!provat.success) {
      console.error(
        "\ndata/library.json skrevs INTE — dokumentet godkänns inte av schemat:",
      );
      for (const i of provat.error.issues.slice(0, 10)) {
        console.error(`  ${i.path.join(".")}: ${i.message}`);
      }
      process.exit(1);
    }
    await writeFile(biblioteket, JSON.stringify(doc, null, 2) + "\n");
  }

  log("");
  if (lagda.length > 0) {
    log(`Installerat ${lagda.join(", ")}`);
    log("            public/models/  och  data/library.json");
    log(
      "            Priserna står på noll. Granska med git diff och committa.",
    );
  }
  for (const h of hoppade) log(`Hoppade över ${h}`);
}

if (trasiga.length > 0) process.exit(1);
