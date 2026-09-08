#!/usr/bin/env node
/**
 * STEP → GLB + katalogkort.
 *
 * Körs offline, en gång per maskintyp. Aldrig i webbläsaren: en 80 MB STEP är
 * B-rep som måste tesselleras innan något kan ritas, och det tar tiotals
 * sekunder och hundratals megabyte trianglar.
 *
 *   node scripts/step-to-glb.mjs <fil.step> [flaggor]
 *
 * Flaggor
 *   --out <katalog>        Utkatalog (standard: public/models)
 *   --id <maskin-id>       Maskin-id i biblioteket. Styr filnamnen.
 *   --tolerance <mm>       Kordatolerans vid tessellering (standard 2).
 *                          Största spaken: 5 mm mot 0,1 mm är ofta 20–50×
 *                          färre trianglar och visuellt identiskt i layoutskala.
 *   --angular <rad>        Vinkeltolerans (standard 0.5)
 *   --min-part <mm>        Utelämna delar vars låda är mindre än detta
 *                          (standard 50 — tar bort skruv, lager, kablage)
 *   --ratio <0..1>         Förenkla till andel av trianglarna (standard 1 = av)
 *   --proxy                Skriv även en kraftigt förenklad proxy-GLB
 *   --up <z|y>             Vilken axel som är upp i källan (standard z)
 *   --quiet
 *
 * Skriver:
 *   <id>.glb          modellen
 *   <id>.card.json    fotavtryck, höjd, portförslag, mätvärden
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import occtimportjs from "occt-import-js";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, quantize } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

/* ── Argument ──────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = {
    tolerance: 2,
    angular: 0.5,
    minPart: 50,
    ratio: 1,
    out: "public/models",
    up: "z",
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--id") args.id = argv[++i];
    else if (a === "--tolerance") args.tolerance = Number(argv[++i]);
    else if (a === "--angular") args.angular = Number(argv[++i]);
    else if (a === "--min-part") args.minPart = Number(argv[++i]);
    else if (a === "--ratio") args.ratio = Number(argv[++i]);
    else if (a === "--up") args.up = argv[++i];
    else if (a === "--proxy") args.proxy = true;
    else if (a === "--quiet") args.quiet = true;
    else rest.push(a);
  }
  args.input = rest[0];
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error("Användning: node scripts/step-to-glb.mjs <fil.step> [--id <maskin-id>] [--tolerance 2]");
  process.exit(1);
}
const log = (...m) => !args.quiet && console.log(...m);
const machineId = args.id ?? path.basename(args.input).replace(/\.[^.]+$/, "").toLowerCase();

/* ── 1. Läs och tessellera ─────────────────────────────────────────────── */

const started = performance.now();
const bytes = new Uint8Array(await readFile(args.input));
log(`STEP        ${args.input}  ${(bytes.length / 1e6).toFixed(1)} MB`);

const occt = await occtimportjs();
/*
 * Kordatoleransen är den största spaken i hela kedjan. Default i de flesta
 * verktyg är tiondels millimeter, vilket ger 200 000+ trianglar per maskin.
 * På en anläggningsritning där maskinen är åtta centimeter på skärmen är det
 * bortkastat: 2–5 mm är visuellt identiskt och tiotals gånger mindre.
 */
const result = occt.ReadStepFile(bytes, {
  linearUnit: "millimeter",
  linearDeflectionType: "absolute_value",
  linearDeflection: args.tolerance,
  angularDeflection: args.angular,
});
if (!result.success) throw new Error("OpenCascade kunde inte läsa filen.");

const raw = result.meshes ?? [];
log(`Delar       ${raw.length}`);

/* ── 2. Släng det som inte syns ────────────────────────────────────────── */

function bounds(positions) {
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

const parts = raw
  .map((mesh) => ({ mesh, b: bounds(mesh.attributes.position.array) }))
  .filter((p) => Number.isFinite(p.b.min[0]));

const kept = parts.filter((p) => Math.max(...p.b.size) >= args.minPart);
const dropped = parts.length - kept.length;
if (kept.length === 0) throw new Error(`Alla delar var mindre än --min-part ${args.minPart} mm.`);
log(`Behållna    ${kept.length}  (${dropped} under ${args.minPart} mm utelämnade)`);

const trianglesIn = kept.reduce((n, p) => n + p.mesh.index.array.length / 3, 0);

/* ── 3. Normalisera: origo, upp-axel, meter ────────────────────────────── */

const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const p of kept) {
  for (let a = 0; a < 3; a++) {
    all.min[a] = Math.min(all.min[a], p.b.min[a]);
    all.max[a] = Math.max(all.max[a], p.b.max[a]);
  }
}

/*
 * Konventionen som resten av systemet bygger på: X i flödesriktningen,
 * Y tvärs, Z upp, origo vid inmatningsporten i golvnivå. glTF är meter,
 * motorn räknar i heltal millimeter — konverteringen sker här, en gång.
 */
const upIsZ = args.up !== "y";
const sizeMm = upIsZ
  ? [all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2]]
  : [all.max[0] - all.min[0], all.max[2] - all.min[2], all.max[1] - all.min[1]];

const originMm = upIsZ
  ? [all.min[0], (all.min[1] + all.max[1]) / 2, all.min[2]]
  : [all.min[0], (all.min[2] + all.max[2]) / 2, all.min[1]];

function toGltf(positions) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    // glTF är Y-upp; vår modell är Z-upp. Byt axlar och skala mm → m.
    const [mx, my, mz] = upIsZ ? [x, y, z] : [x, z, y];
    out[i] = (mx - originMm[0]) / 1000;
    out[i + 1] = (mz - originMm[2]) / 1000;
    out[i + 2] = (my - originMm[1]) / 1000;
  }
  return out;
}

/* ── 4. Bygg glTF ──────────────────────────────────────────────────────── */

async function build(meshes, { ratio, name }) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const material = doc
    .createMaterial("maskin")
    .setBaseColorFactor([0.82, 0.83, 0.85, 1])
    .setMetallicFactor(0.15)
    .setRoughnessFactor(0.65);

  for (const [i, part] of meshes.entries()) {
    const positions = toGltf(part.mesh.attributes.position.array);
    const primitive = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute(
        "POSITION",
        doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType("SCALAR")
          .setArray(new Uint32Array(part.mesh.index.array))
          .setBuffer(buffer),
      );

    if (part.mesh.attributes.normal) {
      const n = part.mesh.attributes.normal.array;
      const normals = new Float32Array(n.length);
      for (let k = 0; k < n.length; k += 3) {
        const [nx, ny, nz] = upIsZ
          ? [n[k], n[k + 1], n[k + 2]]
          : [n[k], n[k + 2], n[k + 1]];
        normals[k] = nx;
        normals[k + 1] = nz;
        normals[k + 2] = ny;
      }
      primitive.setAttribute(
        "NORMAL",
        doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer),
      );
    }

    /*
     * Nodens namn följer delens namn ur STEP:en. Konventionen i biblioteket är
     * att en nod som heter samma sak som en options-id tänds och släcks med
     * den optionen — då behöver visaren ingen kod per maskin.
     */
    const node = doc
      .createNode(part.mesh.name || `del-${i + 1}`)
      .setMesh(doc.createMesh(part.mesh.name || `del-${i + 1}`).addPrimitive(primitive));
    scene.addChild(node);
  }

  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const transforms = [dedup(), weld(), prune()];
  if (ratio < 1) {
    // Förenkling är sista utvägen. Rätt tessellingstolerans är en större spak.
    transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 }));
  }
  // Kvantisering före meshopt: färre bitar per attribut ger mindre fil.
  transforms.push(quantize({ quantizePosition: 14, quantizeNormal: 10 }));
  await doc.transform(...transforms);

  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
    method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
  });

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": null,
  });
  return { glb: await io.writeBinary(doc), doc };
}

const { glb } = await build(kept, { ratio: args.ratio, name: machineId });

await mkdir(args.out, { recursive: true });
const glbPath = path.join(args.out, `${machineId}.glb`);
await writeFile(glbPath, glb);

let proxyPath = null;
if (args.proxy) {
  const { glb: proxy } = await build(kept, { ratio: 0.05, name: `${machineId}-proxy` });
  proxyPath = path.join(args.out, `${machineId}.proxy.glb`);
  await writeFile(proxyPath, proxy);
}

/* ── 5. Katalogkortet ──────────────────────────────────────────────────── */

const round = (v) => Math.round(v);
const card = {
  id: machineId,
  source: path.basename(args.input),
  generatedAt: new Date().toISOString(),
  footprint: {
    lengthMm: round(sizeMm[0]),
    widthMm: round(sizeMm[1]),
    heightMm: round(sizeMm[2]),
  },
  /*
   * Portförslag, inte sanning. Solvern behöver X i flödesriktningen, Y tvärs
   * och samma höjd på båda sidor — det här är utgångsläget som konstruktören
   * rättar i admin-vyn.
   */
  ports: [
    {
      id: "in",
      role: "in",
      pos: { x: 0, y: round(sizeMm[1] / 2) },
      dir: "x+",
      levelMm: 900,
      widthMm: [600, 1600],
      allowsDirectionChange: false,
    },
    {
      id: "out",
      role: "out",
      pos: { x: round(sizeMm[0]), y: round(sizeMm[1] / 2) },
      dir: "x+",
      levelMm: 900,
      widthMm: [600, 1600],
      allowsDirectionChange: false,
    },
  ],
  model: {
    glb: `/${path.relative("public", glbPath).split(path.sep).join("/")}`,
    proxy: proxyPath
      ? `/${path.relative("public", proxyPath).split(path.sep).join("/")}`
      : null,
  },
  stats: {
    stepBytes: bytes.length,
    glbBytes: glb.length,
    partsIn: parts.length,
    partsKept: kept.length,
    trianglesIn,
    toleranceMm: args.tolerance,
    minPartMm: args.minPart,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  },
  dimensionsVerified: false,
};

const cardPath = path.join(args.out, `${machineId}.card.json`);
await writeFile(cardPath, JSON.stringify(card, null, 2));

const m = (v) => (v / 1000).toFixed(2).replace(".", ",");

/* ── Rimlighetskontroll ────────────────────────────────────────────────── */

/*
 * Fel längdenhet är det vanligaste felet i en STEP-leverans — tum tolkade som
 * millimeter, eller en modell ritad i centimeter. Det syns direkt på
 * storleksordningen, så säg till i stället för att låta en 8 cm hög maskin
 * hamna i biblioteket.
 */
const warnings = [];
const biggest = Math.max(...sizeMm);
if (biggest < 500) {
  warnings.push(
    `Största måttet är bara ${m(biggest)} m. Kontrollera längdenheten i STEP-filen — ` +
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
card.warnings = warnings;
await writeFile(cardPath, JSON.stringify(card, null, 2));

/* ── Sammanfattning ────────────────────────────────────────────────────── */

log("");
log(`Fotavtryck  ${m(sizeMm[0])} × ${m(sizeMm[1])} × ${m(sizeMm[2])} m`);
log(`Trianglar   ${trianglesIn.toLocaleString("sv-SE")}`);
log(`GLB         ${(glb.length / 1e6).toFixed(2)} MB   (${(bytes.length / glb.length).toFixed(1)}× mindre än STEP)`);
if (proxyPath) log(`Proxy       ${proxyPath}`);
log(`Kort        ${cardPath}`);
log(`Tid         ${card.stats.seconds} s`);
if (warnings.length > 0) {
  log("");
  for (const w of warnings) log(`VARNING     ${w}`);
}
