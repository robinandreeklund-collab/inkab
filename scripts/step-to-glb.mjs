#!/usr/bin/env node
/**
 * STEP → GLB + katalogkort.
 *
 *   node scripts/step-to-glb.mjs <fil.step ...> [flaggor]
 *   node scripts/step-to-glb.mjs <katalog> [flaggor]
 *
 * Samma konvertering som admin-vyns uppladdning: båda anropar
 * src/lib/cad/stepConvert.ts. Det här skriptet är CLI:t runt den, för
 * filer som är för stora för att skicka genom webbläsaren eller för körningar
 * som ska in i repot under public/models.
 *
 * Webbläsaren är taket på stora sammanställningar: fliken har ett par
 * gigabyte att röra sig med, och en 60 MB STEP spränger dem mitt i
 * tesselleringen. Här körs samma kod med datorns minne i stället, och
 * skriptet startar om sig självt med en rejäl heap. Flera filer eller en hel
 * katalog i ett svep: en fil som fallerar stoppar inte de andra.
 *
 * Flaggor
 *   --out <katalog>        Utkatalog (standard: public/models)
 *   --id <maskin-id>       Maskin-id i biblioteket. Styr filnamnen. Gäller
 *                          bara en ensam fil; i en batch kommer namnen ur
 *                          filnamnen.
 *   --heap <MB>            Tak för Nodes JS-heap (standard 8192).
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
import { writeFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Konverteringen ligger i en TypeScript-modul som admin-vyns web worker också
 * använder. Node kan köra den direkt med --experimental-strip-types; saknas
 * flaggan startar skriptet om sig självt med den, så att
 * `node scripts/step-to-glb.mjs` räcker.
 */
const REQUIRED_FLAGS = ["--experimental-strip-types"];
const HEAP_FLAG = "--max-old-space-size";

/*
 * Heapen sätts också om, och av samma skäl som filen körs här i stället för i
 * webbläsaren: en tung sammanställning håller hundratals megabyte trianglar
 * samtidigt. Taket är ett tak, inte en reservation — en dator med mindre minne
 * blir inte sämre av det.
 */
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

const { convertStep, suggestPorts } = await import(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src/lib/cad/stepConvert.ts")
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
    else if (a === "--heap") i++; // läses före omstarten
    else if (a === "--proxy") args.proxy = true;
    else if (a === "--quiet") args.quiet = true;
    else rest.push(a);
  }
  args.inputs = rest;
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.inputs.length === 0) {
  console.error(
    "Användning: node scripts/step-to-glb.mjs <fil.step ... | katalog> " +
      "[--id <maskin-id>] [--tolerance 2] [--proxy]",
  );
  process.exit(1);
}

const log = (...m) => !args.quiet && console.log(...m);

/* ── Vilka filer ───────────────────────────────────────────────────────── */

const isStep = (name) => /\.(stp|step)$/i.test(name);

/** Katalog → STEP-filerna i den. Fil → sig själv. */
async function collect(inputs) {
  const files = [];
  for (const input of inputs) {
    const info = await stat(input).catch(() => null);
    if (!info) {
      console.error(`Hittar inte ${input}`);
      process.exit(1);
    }
    if (info.isDirectory()) {
      const found = (await readdir(input)).filter(isStep).sort();
      if (found.length === 0) console.error(`Inga STEP-filer i ${input}`);
      files.push(...found.map((name) => path.join(input, name)));
    } else {
      files.push(input);
    }
  }
  return files;
}

const files = await collect(args.inputs);
if (files.length === 0) process.exit(1);

// --id namnger en modell, och det finns bara en att namnge när det är en fil.
if (args.id && files.length > 1) {
  log("--id gäller bara en ensam fil; namnen kommer ur filnamnen i den här körningen.\n");
  args.id = undefined;
}

/* ── Konvertera ────────────────────────────────────────────────────────── */

const m = (v) => (v / 1000).toFixed(2).replace(".", ",");

/** Sökvägen som webbadress, eller null när filen inte ligger under public/. */
const url = (file) => {
  const rel = path.relative("public", file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return `/${rel.split(path.sep).join("/")}`;
};

async function convertOne(input) {
  const machineId =
    args.id ??
    path
      .basename(input)
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const step = new Uint8Array(await readFile(input));
  log(`STEP        ${input}  ${(step.length / 1e6).toFixed(1)} MB`);

  const result = await convertStep(step, {
    toleranceMm: args.tolerance,
    angularDeflection: args.angular,
    minPartMm: args.minPart,
    ratio: args.ratio,
    up: args.up,
    proxy: !!args.proxy,
  });

  await mkdir(args.out, { recursive: true });

  const glbPath = path.join(args.out, `${machineId}.glb`);
  await writeFile(glbPath, result.glb);

  let proxyPath = null;
  if (result.proxy) {
    proxyPath = path.join(args.out, `${machineId}.proxy.glb`);
    await writeFile(proxyPath, result.proxy);
  }

  const card = {
    id: machineId,
    source: path.basename(input),
    generatedAt: new Date().toISOString(),
    footprint: result.footprint,
    /*
     * Portförslag, inte sanning. Solvern behöver X i flödesriktningen, Y tvärs
     * och samma höjd på båda sidor — det här är utgångsläget som konstruktören
     * rättar i admin-vyn.
     */
    ports: suggestPorts(result.footprint),
    model: {
      glb: url(glbPath) ?? glbPath,
      proxy: proxyPath ? (url(proxyPath) ?? proxyPath) : null,
    },
    stats: result.stats,
    warnings: result.warnings,
    dimensionsVerified: false,
  };

  const cardPath = path.join(args.out, `${machineId}.card.json`);
  await writeFile(cardPath, JSON.stringify(card, null, 2));

  log(`Delar       ${result.stats.partsKept} av ${result.stats.partsIn}`);
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
  // Det här är strängen som ska stå i maskinens GLB-fält i admin-vyn. Ligger
  // filen utanför public/ finns ingen adress att ge — den måste flyttas dit.
  const web = url(glbPath);
  log(web ? `GLB-fältet  ${web}` : `GLB-fältet  flytta ${glbPath} till public/models först`);
  for (const w of result.warnings) log(`VARNING     ${w}`);

  return glbPath;
}

/* ── Kör ───────────────────────────────────────────────────────────────── */

const failed = [];
const done = [];

for (const [i, input] of files.entries()) {
  if (i > 0) log("");
  try {
    done.push(await convertOne(input));
  } catch (error) {
    // En trasig fil i en batch ska inte ta de andra med sig.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`MISSLYCKADES ${input}`);
    console.error(`             ${message}`);
    failed.push(input);
  }
}

if (files.length > 1) {
  log("");
  log(`Klart       ${done.length} av ${files.length} filer`);
}
if (failed.length > 0) process.exit(1);
