#!/usr/bin/env node
/**
 * Kopierar OpenCascades wasm till public/ före bygget.
 *
 * Konverteringen körs i webbläsaren, och Emscripten hämtar sin .wasm över
 * nätet. Filen är 7,6 MB och hör till paketet, inte till repot — den kopieras
 * därför vid bygget i stället för att checkas in, så att den aldrig kan bli
 * en annan version än den occt-import-js i node_modules förväntar sig.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const source = "node_modules/occt-import-js/dist/occt-import-js.wasm";
const target = "public/occt/occt-import-js.wasm";

try {
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  const { size } = await stat(target);
  console.log(`occt wasm  ${target}  ${(size / 1e6).toFixed(1)} MB`);
} catch (error) {
  console.error(
    `Kunde inte kopiera ${source}. Utan den kan admin-vyn inte konvertera STEP.`,
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
