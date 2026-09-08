#!/usr/bin/env node
/**
 * STEP → GLB + katalogkort.
 *
 *   node scripts/step-to-glb.mjs <fil.step> [flaggor]
 *
 * Samma konvertering som admin-vyns uppladdning: båda anropar
 * src/lib/server/stepConvert.ts. Det här skriptet är CLI:t runt den, för
 * filer som är för stora för att skicka genom webbläsaren eller för körningar
 * som ska in i repot under public/models.
 *
 * Flaggor
 *   --out <katalog>        Utkatalog (standard: public/models)
 *   --id <maskin-id>       Maskin-id i biblioteket. Styr filnamnen.
 *   --tolerance <mm>       Kordatolerans vid tessellering (standard 2).
 *                          Största spaken: 5 mm mot 0,1 mm är ofta 15–35×
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
 *   <id>.proxy.glb    med --proxy
 *   <id>.card.json    fotavtryck, höjd, portförslag, mätvärden
 */

import { spawnSync } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Konverteringen ligger i en TypeScript-modul som Next också använder. Node
 * kan köra den direkt, men behöver två flaggor: --experimental-strip-types
 * för typerna, och --conditions=react-server för att paketet server-only ska
 * lösas till sin tomma variant i stället för att kasta. Saknas de startar
 * skriptet om sig självt med dem, så `node scripts/step-to-glb.mjs` räcker.
 */
const REQUIRED_FLAGS = ["--experimental-strip-types", "--conditions=react-server"];
const missing = REQUIRED_FLAGS.filter((flag) => !process.execArgv.includes(flag));
if (missing.length > 0) {
  const self = fileURLToPath(import.meta.url);
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, ...REQUIRED_FLAGS, self, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
  );
  process.exit(child.status ?? 1);
}

const { convertStep, suggestPorts } = await import(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src/lib/server/stepConvert.ts")
);

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
  console.error(
    "Användning: node scripts/step-to-glb.mjs <fil.step> [--id <maskin-id>] [--tolerance 2]",
  );
  process.exit(1);
}

const log = (...m) => !args.quiet && console.log(...m);
const machineId = args.id ?? path.basename(args.input).replace(/\.[^.]+$/, "").toLowerCase();

/* ── Konvertera ────────────────────────────────────────────────────────── */

const step = new Uint8Array(await readFile(args.input));
log(`STEP        ${args.input}  ${(step.length / 1e6).toFixed(1)} MB`);

const result = await convertStep(step, {
  toleranceMm: args.tolerance,
  angularDeflection: args.angular,
  minPartMm: args.minPart,
  ratio: args.ratio,
  up: args.up,
  proxy: !!args.proxy,
});

/* ── Skriv ─────────────────────────────────────────────────────────────── */

await mkdir(args.out, { recursive: true });

const glbPath = path.join(args.out, `${machineId}.glb`);
await writeFile(glbPath, result.glb);

let proxyPath = null;
if (result.proxy) {
  proxyPath = path.join(args.out, `${machineId}.proxy.glb`);
  await writeFile(proxyPath, result.proxy);
}

/** Sökväg som webbadress under public/, annars som den är. */
const url = (file) => `/${path.relative("public", file).split(path.sep).join("/")}`;

const card = {
  id: machineId,
  source: path.basename(args.input),
  generatedAt: new Date().toISOString(),
  footprint: result.footprint,
  /*
   * Portförslag, inte sanning. Solvern behöver X i flödesriktningen, Y tvärs
   * och samma höjd på båda sidor — det här är utgångsläget som konstruktören
   * rättar i admin-vyn.
   */
  ports: suggestPorts(result.footprint),
  model: { glb: url(glbPath), proxy: proxyPath ? url(proxyPath) : null },
  stats: result.stats,
  warnings: result.warnings,
  dimensionsVerified: false,
};

const cardPath = path.join(args.out, `${machineId}.card.json`);
await writeFile(cardPath, JSON.stringify(card, null, 2));

/* ── Sammanfattning ────────────────────────────────────────────────────── */

const m = (v) => (v / 1000).toFixed(2).replace(".", ",");

log(`Delar       ${result.stats.partsKept} av ${result.stats.partsIn}`);
log("");
log(
  `Fotavtryck  ${m(result.footprint.lengthMm)} × ${m(result.footprint.widthMm)} × ` +
    `${m(result.footprint.heightMm)} m`,
);
log(`Trianglar   ${result.stats.trianglesIn.toLocaleString("sv-SE")}`);
log(
  `GLB         ${(result.glb.length / 1e6).toFixed(2)} MB   ` +
    `(${(step.length / result.glb.length).toFixed(1)}× mindre än STEP)`,
);
if (proxyPath) log(`Proxy       ${proxyPath}`);
log(`Kort        ${cardPath}`);
log(`Tid         ${result.stats.seconds} s`);
if (result.warnings.length > 0) {
  log("");
  for (const w of result.warnings) log(`VARNING     ${w}`);
}
