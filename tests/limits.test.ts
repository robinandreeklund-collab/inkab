import { describe, expect, it } from "vitest";
import { clampTo, PRODUCT_LIMITS, setProductValue } from "@/lib/limits";
import { configurationSchema } from "@/lib/schema";
import { emptyConfig } from "@/lib/templates";

/**
 * Fälten håller sig inom serverns gränser.
 *
 * Ett värde som servern underkänner gör hela konfigurationen ogiltig: priset,
 * sparandet och delningslänken slutar fungera utan att något säger varför.
 */
describe("paketets mått inom gränserna", () => {
  it("klämmer värden utanför intervallet och avrundar till heltal", () => {
    const { product } = emptyConfig();
    setProductValue(product, "packageHeightMm", 50);
    setProductValue(product, "targetPackagesPerHour", 300);
    setProductValue(product, "packageWeightKg", 1234.6);
    expect(product.packageHeightMm).toBe(PRODUCT_LIMITS.packageHeightMm[0]);
    expect(product.targetPackagesPerHour).toBe(200);
    expect(product.packageWeightKg).toBe(1235);
  });

  it("låter inte minsta virkesbredd bli större än största", () => {
    const config = emptyConfig();
    setProductValue(config.product, "packageWidthMinMm", 1500);
    expect(config.product.packageWidthMaxMm).toBeGreaterThanOrEqual(1500);
    setProductValue(config.product, "packageWidthMaxMm", 600);
    expect(config.product.packageWidthMinMm).toBeLessThanOrEqual(600);
  });

  it("det som fälten släpper igenom godtar servern", () => {
    const config = emptyConfig();
    for (const key of Object.keys(PRODUCT_LIMITS) as (keyof typeof PRODUCT_LIMITS)[]) {
      setProductValue(config.product, key, -5);
      setProductValue(config.product, key, 1e9);
    }
    expect(configurationSchema.safeParse(config).success).toBe(true);
  });

  it("clampTo håller sig inom ett intervall", () => {
    expect(clampTo(1, [5, 10])).toBe(5);
    expect(clampTo(99, [5, 10])).toBe(10);
  });
});
