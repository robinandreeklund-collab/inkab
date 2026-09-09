#!/usr/bin/env node
/**
 * Kopierar de filer webbläsaren hämtar över nätet till public/ före bygget.
 *
 * Tungt arbete görs i webbläsaren — STEP blir GLB, pdf blir sidbilder — och
 * bibliotekens egna körfiler hämtas då som vanliga resurser. De hör till
 * paketen, inte till repot, och kopieras därför vid bygget i stället för att
 * checkas in: så kan de aldrig bli en annan version än den node_modules
 * förväntar sig.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const assets = [
  {
    source: "node_modules/occt-import-js/dist/occt-import-js.wasm",
    target: "public/occt/occt-import-js.wasm",
    why: "Utan den kan admin-vyn inte konvertera STEP.",
  },
  {
    source: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    target: "public/pdf/pdf.worker.min.mjs",
    why: "Utan den kan uppladdade pdf-ritningar inte göras om till bilder.",
  },
];

for (const { source, target, why } of assets) {
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    const { size } = await stat(target);
    console.log(`${target}  ${(size / 1e6).toFixed(1)} MB`);
  } catch (error) {
    console.error(
      `Kunde inte kopiera ${source}. ${why}`,
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}
