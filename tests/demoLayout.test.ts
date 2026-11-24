import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { TEMPLATES, templateConfig } from "@/lib/templates";
import { BUILTIN_LIBRARY, makeLibrary } from "@/lib/library";
import { DEMO_DRAWN, DEMO_LINE } from "@/lib/demoLayout";
import type { Machine } from "@/lib/types";

/*
 * Anmärkningarna mäts mot katalogen som faktiskt levereras.
 *
 * De inbyggda maskinerna är en reserv med delvis andra mått, och mot dem
 * blir det färre R-106 — en siffra som inte stämmer med vad kunden ser.
 */
const KATALOG = makeLibrary(
  (
    JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "library.json"), "utf-8"),
    ) as { machines: Machine[] }
  ).machines,
);

/**
 * Demoanläggningen på startsidan.
 *
 * Den är en riktig hall någon ritat, inte en mall som läggs ut på rad, och
 * därför gäller inte kravet att den ska öppna utan anmärkningar. Men den
 * ska öppna med exakt de anmärkningar den faktiskt ger — annars är det
 * något annat som ändrats, och då ska det här testet säga ifrån.
 */
const demo = () => templateConfig("demo", BUILTIN_LIBRARY);

describe("demoanläggningen", () => {
  it("finns bland mallarna på startsidan", () => {
    const tpl = TEMPLATES.find((t) => t.id === "demo");
    expect(tpl).toBeDefined();
    expect(tpl!.demo).toBe(true);
    expect(tpl!.machineIds).toHaveLength(15);
  });

  it("öppnas precis som den ritades", () => {
    const config = demo();
    expect(config.hall).toEqual({
      lengthMm: 60000,
      widthMm: 30000,
      clearHeightMm: 6000,
    });
    // Positionerna är ritningen. Räknas de om är det inte längre samma hall.
    expect(config.line.map((i) => i.pos)).toEqual(DEMO_LINE.map((i) => i.pos));
    expect(config.line.map((i) => i.rotation)).toEqual(
      DEMO_LINE.map((i) => i.rotation),
    );
    expect(config.drawn).toEqual(DEMO_DRAWN);
    expect(config.dimensions).toHaveLength(2);
  });

  it("ger varje maskin ett eget instans-id, nytt för varje öppning", () => {
    const a = demo();
    const b = demo();
    expect(new Set(a.line.map((i) => i.instanceId)).size).toBe(15);
    expect(
      a.line.some((i, n) => i.instanceId === b.line[n].instanceId),
    ).toBe(false);
  });

  it("hittar alla femton maskinerna i det inbyggda biblioteket", () => {
    // Serverkatalogen kan vara nere. Då byggs demon med det inbyggda
    // biblioteket, och saknas en maskin där blir R-107 det första kunden ser.
    const koder = computeLayout(demo(), BUILTIN_LIBRARY).diagnostics.map(
      (d) => d.code,
    );
    expect(koder).not.toContain("R-107");
  });

  it("öppnar med de anmärkningar ritningen ger, varken fler eller färre", () => {
    const diagnostik = computeLayout(demo(), KATALOG).diagnostics;
    const antal = diagnostik.reduce<Record<string, number>>((acc, d) => {
      acc[d.code] = (acc[d.code] ?? 0) + 1;
      return acc;
    }, {});
    expect(antal, JSON.stringify(diagnostik.map((d) => d.detail), null, 2))
      .toEqual({
        /*
         * Två fel och åtta varningar, och alla stämmer.
         *
         * R-103: den höj- och sänkbara kedjekanalen är 7,2 × 5,1 m i den
         * uppmätta katalogen och går 5,4 m² in i paketlyften. Den ritades när
         * posten fortfarande bar en uppskattning på 4,0 × 2,2 m, så överlappet
         * syntes inte då. Det är en riktig krock i en riktig ritning.
         *
         * R-403 och sex av R-106: kunden har ritat en spärrad yta tvärs över
         * maskiner. Den sjunde R-106:an är kedjekanalen som står inne i
         * maskinzonen kring per sida-varianten.
         *
         * R-301: paketlyften klarar 16 paket/h, linjen är satt till 18.
         */
        "R-103": 1,
        "R-403": 1,
        "R-106": 7,
        "R-301": 1,
      });
  });
});
