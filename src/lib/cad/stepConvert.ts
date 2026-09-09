import occtimportjs, { type OcctMesh } from "occt-import-js";
import { Document, WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, quantize, simplify, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import type { Port } from "@/lib/types";

/**
 * STEP → GLB.
 *
 * En STEP är B-rep som måste tesselleras innan något kan ritas, och det tar
 * sekunder till minuter och hundratals megabyte trianglar. Just därför körs
 * det INTE i webbservern: en 512 MB-instans dör av en stor sammanställning,
 * och tar hela sajten med sig. Arbetet hör hemma där minnet finns —
 * konstruktörens egen dator.
 *
 * Modulen är därför plattformsneutral. Den körs i en web worker i admin-vyn
 * och i Node av scripts/step-to-glb.mjs, med samma kod på båda ställena.
 * WebIO används i stället för NodeIO eftersom writeBinary inte rör filsystemet
 * och WebIO fungerar i båda miljöerna.
 */

export type ConvertOptions = {
  /** Kordatolerans i mm. Största spaken: 5 mm mot 0,1 mm är ofta 15–35×
   *  färre trianglar på krökt geometri, och visuellt identiskt i layoutskala. */
  toleranceMm?: number;
  angularDeflection?: number;
  /** Delar vars omslutande låda är mindre än detta utelämnas — skruv, lager,
   *  kablage. Det är där filstorleken kommer ifrån. */
  minPartMm?: number;
  /** Förenkla till andel av trianglarna. 1 = av. Sista utvägen. */
  ratio?: number;
  /** Vilken axel som är upp i källan. */
  up?: "z" | "y";
  /** Skriv även en kraftigt förenklad proxy. */
  proxy?: boolean;
  /**
   * Var .wasm-filen ligger. I webbläsaren måste den pekas ut, annars letar
   * Emscripten bredvid det bundlade skriptet. I Node hittar den själv.
   */
  wasmUrl?: string;
  /** Kallas när ett steg börjar. Konverteringen tar minuter på tung geometri. */
  onProgress?: (stage: ConvertStage) => void;
};

export type ConvertStage =
  | "laddar"
  | "tessellerar"
  | "rensar"
  | "bygger"
  | "förenklar"
  | "komprimerar";

export type ConvertResult = {
  glb: Uint8Array;
  proxy: Uint8Array | null;
  footprint: { lengthMm: number; widthMm: number; heightMm: number };
  ports: Port[];
  warnings: string[];
  stats: {
    stepBytes: number;
    glbBytes: number;
    proxyBytes: number | null;
    partsIn: number;
    partsKept: number;
    trianglesIn: number;
    toleranceMm: number;
    minPartMm: number;
    seconds: number;
  };
};

const DEFAULTS = {
  toleranceMm: 2,
  angularDeflection: 0.5,
  minPartMm: 50,
  ratio: 1,
  up: "z" as const,
  proxy: false,
};

type Part = { mesh: OcctMesh; min: number[]; max: number[]; size: number[] };

function bounds(positions: number[]): Omit<Part, "mesh"> {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export async function convertStep(
  step: Uint8Array,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const opt = { ...DEFAULTS, ...options };
  const started = Date.now();
  const report = (stage: ConvertStage) => options.onProgress?.(stage);

  /* ── Tessellera ──────────────────────────────────────────────────────── */
  report("laddar");
  const occt = await occtimportjs(
    opt.wasmUrl ? { locateFile: () => opt.wasmUrl as string } : undefined,
  );
  report("tessellerar");
  const read = occt.ReadStepFile(step, {
    linearUnit: "millimeter",
    linearDeflectionType: "absolute_value",
    linearDeflection: opt.toleranceMm,
    angularDeflection: opt.angularDeflection,
  });
  if (!read.success || !read.meshes?.length) {
    throw new Error("OpenCascade kunde inte läsa filen. Är det en giltig STEP?");
  }

  /* ── Släng det som inte syns ─────────────────────────────────────────── */
  report("rensar");
  const parts: Part[] = read.meshes
    .map((mesh) => ({ mesh, ...bounds(mesh.attributes.position.array) }))
    .filter((p) => Number.isFinite(p.min[0]));

  const kept = parts.filter((p) => Math.max(...p.size) >= opt.minPartMm);
  if (kept.length === 0) {
    throw new Error(
      `Alla ${parts.length} delar var mindre än gränsen ${opt.minPartMm} mm. Sänk den.`,
    );
  }
  const trianglesIn = kept.reduce((n, p) => n + p.mesh.index.array.length / 3, 0);

  /* ── Normalisera: origo, upp-axel, meter ─────────────────────────────── */
  const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const p of kept) {
    for (let a = 0; a < 3; a++) {
      all.min[a] = Math.min(all.min[a], p.min[a]);
      all.max[a] = Math.max(all.max[a], p.max[a]);
    }
  }

  const upIsZ = opt.up !== "y";
  const sizeMm = upIsZ
    ? [all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2]]
    : [all.max[0] - all.min[0], all.max[2] - all.min[2], all.max[1] - all.min[1]];

  // Origo i inmatningsporten vid golvnivå, X i flödesriktningen — samma
  // konvention som solvern, så modell och layout hamnar på samma plats.
  const originMm = upIsZ
    ? [all.min[0], (all.min[1] + all.max[1]) / 2, all.min[2]]
    : [all.min[0], (all.min[2] + all.max[2]) / 2, all.min[1]];

  const toGltf = (positions: number[]) => {
    const out = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      // glTF är Y-upp och meter; vår geometri är Z-upp och millimeter.
      const [mx, my, mz] = upIsZ ? [x, y, z] : [x, z, y];
      out[i] = (mx - originMm[0]) / 1000;
      out[i + 1] = (mz - originMm[2]) / 1000;
      out[i + 2] = (my - originMm[1]) / 1000;
    }
    return out;
  };

  /* ── Bygg glTF ───────────────────────────────────────────────────────── */
  const build = async (ratio: number, name: string) => {
    report(ratio < 1 ? "förenklar" : "bygger");
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene(name);
    const material = doc
      .createMaterial("maskin")
      .setBaseColorFactor([0.82, 0.83, 0.85, 1])
      .setMetallicFactor(0.15)
      .setRoughnessFactor(0.65);

    for (const [i, part] of kept.entries()) {
      const primitive = doc
        .createPrimitive()
        .setMaterial(material)
        .setAttribute(
          "POSITION",
          doc
            .createAccessor()
            .setType("VEC3")
            .setArray(toGltf(part.mesh.attributes.position.array))
            .setBuffer(buffer),
        )
        .setIndices(
          doc
            .createAccessor()
            .setType("SCALAR")
            .setArray(new Uint32Array(part.mesh.index.array))
            .setBuffer(buffer),
        );

      const source = part.mesh.attributes.normal?.array;
      if (source) {
        const normals = new Float32Array(source.length);
        for (let k = 0; k < source.length; k += 3) {
          const [nx, ny, nz] = upIsZ
            ? [source[k], source[k + 1], source[k + 2]]
            : [source[k], source[k + 2], source[k + 1]];
          normals[k] = nx;
          normals[k + 1] = nz;
          normals[k + 2] = ny;
        }
        primitive.setAttribute(
          "NORMAL",
          doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer),
        );
      }

      // Nodnamnet följer delens namn ur STEP:en. Heter en nod samma sak som en
      // options-id i biblioteket tänds och släcks den med den optionen.
      const label = part.mesh.name || `del-${i + 1}`;
      scene.addChild(
        doc.createNode(label).setMesh(doc.createMesh(label).addPrimitive(primitive)),
      );
    }

    await MeshoptEncoder.ready;
    await MeshoptSimplifier.ready;

    const steps = [dedup(), weld(), prune()];
    if (ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 }));
    steps.push(quantize({ quantizePosition: 14, quantizeNormal: 10 }));
    await doc.transform(...steps);
    report("komprimerar");

    doc
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": null });
    return io.writeBinary(doc);
  };

  const glb = await build(opt.ratio, name(sizeMm));
  const proxy = opt.proxy ? await build(0.05, "proxy") : null;

  /* ── Rimlighetskontroll ──────────────────────────────────────────────── */
  const m = (v: number) => (v / 1000).toFixed(2).replace(".", ",");
  const warnings: string[] = [];
  const biggest = Math.max(...sizeMm);

  // Fel längdenhet är det vanligaste felet i en STEP-leverans, och det syns
  // direkt på storleksordningen.
  if (biggest < 500) {
    warnings.push(
      `Största måttet är bara ${m(biggest)} m. Kontrollera längdenheten i filen — ` +
        "en maskin brukar vara meter, inte centimeter.",
    );
  } else if (biggest > 60_000) {
    warnings.push(
      `Största måttet är ${m(biggest)} m. Kontrollera att filen innehåller en maskin ` +
        "och inte en hel anläggning.",
    );
  }
  if (sizeMm[2] < 100) {
    warnings.push(`Höjden ${m(sizeMm[2])} m är för låg för en maskin i biblioteket.`);
  }
  if (trianglesIn > 400_000) {
    warnings.push(
      `${trianglesIn.toLocaleString("sv-SE")} trianglar är mycket. Höj toleransen eller ` +
        "gränsen för smådelar.",
    );
  }

  const footprint = {
    lengthMm: Math.round(sizeMm[0]),
    widthMm: Math.round(sizeMm[1]),
    heightMm: Math.round(sizeMm[2]),
  };

  return {
    glb,
    proxy,
    footprint,
    ports: suggestPorts(footprint),
    warnings,
    stats: {
      stepBytes: step.length,
      glbBytes: glb.length,
      proxyBytes: proxy?.length ?? null,
      partsIn: parts.length,
      partsKept: kept.length,
      trianglesIn,
      toleranceMm: opt.toleranceMm,
      minPartMm: opt.minPartMm,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    },
  };
}

function name(sizeMm: number[]) {
  return `maskin-${Math.round(sizeMm[0])}x${Math.round(sizeMm[1])}`;
}

/**
 * Portförslag på fotavtryckets kanter. Det är en gissning, inte sanning —
 * en konstruktör måste bekräfta lägena innan maskinen visas för kund.
 */
export function suggestPorts(footprint: {
  lengthMm: number;
  widthMm: number;
}): Port[] {
  const y = Math.round(footprint.widthMm / 2);
  const common = {
    levelMm: 900,
    widthMm: [600, 1600] as [number, number],
    allowsDirectionChange: false,
  };
  return [
    { id: "in", role: "in", pos: { x: 0, y }, dir: "x+", ...common },
    { id: "out", role: "out", pos: { x: footprint.lengthMm, y }, dir: "x+", ...common },
  ];
}
