import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { priceConfiguration } from "@/lib/server/pricing";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { makeLibrary } from "@/lib/library";
import { templateConfig, lineItem } from "@/lib/templates";
import type { Machine } from "@/lib/types";

/**
 * Maskinlistan i offerten.
 *
 * En maskin utan post i prisboken föll förut ur listan helt: den stod i
 * kundens linje, i ritningen och i 3D-vyn, men offerten hoppade över den och
 * positionsnumren hoppade ett steg. Underlaget visade alltså färre maskiner
 * än kunden hade valt, utan att säga det. Den som läser en offert ska kunna
 * lita på att varje maskin i linjen står där.
 */
const KATALOG = makeLibrary(
  (
    JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "library.json"), "utf-8"),
    ) as { machines: Machine[] }
  ).machines,
);

describe("offertens maskinlista", () => {
  it("tar med varje maskin i linjen, också de utan pris", () => {
    const config = templateConfig("demo", KATALOG);
    const pris = priceConfiguration(
      config,
      "guest",
      KATALOG,
      BUILTIN_PRICE_BOOK,
      null,
      "sv",
    );
    expect(pris.lines).toHaveLength(config.line.length);
    expect(pris.lines.map((l) => l.pos)).toEqual(
      config.line.map((_, i) => i + 1),
    );
    expect(pris.lines.map((l) => l.machineId)).toEqual(
      config.line.map((i) => i.machineId),
    );
  });

  it("märker ut raden som saknar pris i stället för att dölja den", () => {
    const config = templateConfig("demo", KATALOG);
    const pris = priceConfiguration(
      config,
      "admin",
      KATALOG,
      BUILTIN_PRICE_BOOK,
      null,
      "sv",
    );
    const utanPris = pris.lines.filter((l) => l.unpriced);
    expect(utanPris.length).toBeGreaterThan(0);
    for (const rad of utanPris) {
      expect(rad.rowTotal, rad.name).toBeUndefined();
      expect(rad.name, rad.machineId).toBeTruthy();
      expect(rad.sku, rad.machineId).toBeTruthy();
    }
  });

  it("räknar inte oprissatta maskiner som noll kronor i summan", () => {
    // Ett pris som inte finns får inte göra anläggningen billigare.
    const utan = templateConfig("demo", KATALOG);
    const med = templateConfig("demo", KATALOG);
    med.line.push(lineItem("kedjekanal-hojsank-sidvis"));

    const summa = (c: typeof utan) =>
      priceConfiguration(c, "admin", KATALOG, BUILTIN_PRICE_BOOK, null, "sv")
        .totals?.machines ?? 0;
    expect(summa(med)).toBe(summa(utan));
  });

  it("en prissatt maskin till höjer summan", () => {
    const utan = templateConfig("demo", KATALOG);
    const med = templateConfig("demo", KATALOG);
    med.line.push(lineItem("rullbana"));
    const summa = (c: typeof utan) =>
      priceConfiguration(c, "admin", KATALOG, BUILTIN_PRICE_BOOK, null, "sv")
        .totals?.machines ?? 0;
    expect(summa(med)).toBeGreaterThan(summa(utan));
  });
});
