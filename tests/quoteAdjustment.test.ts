import { describe, expect, it } from "vitest";
import { adjustmentLabel, applyAdjustment, normaliseAdjustment } from "@/lib/quoteAdjustment";
import { priceConfiguration } from "@/lib/server/pricing";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { templateConfig } from "@/lib/templates";

/**
 * Rabatten på en enskild offert.
 *
 * Den räknas på servern som allt annat pris, och den ska synas: ett belopp som
 * sänkts utan att avdraget står utskrivet är inte en rabatt utan ett annat
 * pris, och kunden kan inte stämma av det mot katalogen.
 */

describe("normaliseAdjustment", () => {
  it("klipper procenten till 0–100 och avrundar till tiondelar", () => {
    expect(normaliseAdjustment({ discountPercent: 250 }).discountPercent).toBe(100);
    expect(normaliseAdjustment({ discountPercent: -5 }).discountPercent).toBeUndefined();
    expect(normaliseAdjustment({ discountPercent: 7.26 }).discountPercent).toBe(7.3);
  });

  it("släpper igenom ett fast pris men inte skräp", () => {
    expect(normaliseAdjustment({ fixedTotalSek: 1_250_000 }).fixedTotalSek).toBe(1_250_000);
    expect(normaliseAdjustment({ fixedTotalSek: Number.NaN }).fixedTotalSek).toBeUndefined();
    expect(normaliseAdjustment({ fixedTotalSek: 0 }).fixedTotalSek).toBeUndefined();
  });

  it("ger ett tomt objekt av ingenting", () => {
    expect(normaliseAdjustment(null)).toEqual({});
    expect(normaliseAdjustment({ note: "   " })).toEqual({});
  });
});

describe("applyAdjustment", () => {
  it("räknar av procenten", () => {
    const result = applyAdjustment(1_000_000, { discountPercent: 5 });
    expect(result.finalSek).toBe(950_000);
    expect(result.deltaSek).toBe(50_000);
    expect(result.applied).toBe(true);
    expect(adjustmentLabel(result)).toBe("Avdrag 5 %");
  });

  it("låter ett avtalat pris gå före procenten", () => {
    // Att först förhandla fram en totalsumma och sedan dra procent på den vore
    // att förhandla två gånger.
    const result = applyAdjustment(1_000_000, { discountPercent: 20, fixedTotalSek: 900_000 });
    expect(result.finalSek).toBe(900_000);
    expect(adjustmentLabel(result)).toBe("Avtalat totalpris");
  });

  it("rör inget utan justering", () => {
    const result = applyAdjustment(1_000_000, {});
    expect(result.finalSek).toBe(1_000_000);
    expect(result.applied).toBe(false);
  });

  it("räknar en notering som en justering värd att visa", () => {
    expect(applyAdjustment(1000, { note: "Ramavtal 2026" }).applied).toBe(true);
  });
});

describe("priset med offertens justering", () => {
  const config = templateConfig("strolinje");

  it("sänker summan men lämnar raderna på listpris", () => {
    const list = priceConfiguration(config, "admin", BUILTIN_LIBRARY, BUILTIN_PRICE_BOOK);
    const discounted = priceConfiguration(config, "admin", BUILTIN_LIBRARY, BUILTIN_PRICE_BOOK, {
      discountPercent: 10,
    });

    expect(list.adjustment).toBeNull();
    expect(discounted.adjustment?.listSek).toBe(list.totals!.grandTotal);
    expect(discounted.totals!.grandTotal).toBe(Math.round(list.totals!.grandTotal * 0.9));
    // Raderna är kundens avstämning mot katalogen och ska inte röras.
    expect(discounted.lines[0].rowTotal).toBe(list.lines[0].rowTotal);
  });

  it("räknar om marginalen mot det pris som faktiskt tas ut", () => {
    const list = priceConfiguration(config, "admin", BUILTIN_LIBRARY, BUILTIN_PRICE_BOOK);
    const discounted = priceConfiguration(config, "admin", BUILTIN_LIBRARY, BUILTIN_PRICE_BOOK, {
      discountPercent: 10,
    });
    expect(discounted.totals!.margin).toBeLessThan(list.totals!.margin);
    expect(discounted.totals!.margin).toBe(
      discounted.totals!.grandTotal - discounted.totals!.cost,
    );
  });

  it("snävar ihop intervallet till ett avtalat pris", () => {
    const fixed = priceConfiguration(config, "guest", BUILTIN_LIBRARY, BUILTIN_PRICE_BOOK, {
      fixedTotalSek: 1_500_000,
    });
    // Ett avtalat pris är inte en indikation utan ett pris.
    expect(fixed.indication.lowSek).toBe(1_500_000);
    expect(fixed.indication.highSek).toBe(1_500_000);
    // Gästen ser fortfarande inga radpriser.
    expect(fixed.totals).toBeNull();
  });
});
