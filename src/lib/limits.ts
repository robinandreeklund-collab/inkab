import type { Hall, Product } from "./types";

/**
 * Gränserna för hallens och paketets mått, på ett ställe.
 *
 * Servern validerar varje konfiguration mot dem (lib/schema.ts), och fälten i
 * gränssnittet håller sig inom dem. Låg de på två ställen kunde ett fält
 * ta emot ett värde som servern sedan underkände — och då slutade priset,
 * sparandet och delningslänken att fungera utan att något sa varför.
 */
export const HALL_LIMITS: Record<keyof Hall, readonly [number, number]> = {
  lengthMm: [5000, 300000],
  widthMm: [5000, 150000],
  clearHeightMm: [2000, 30000],
};

export const PRODUCT_LIMITS: Record<keyof Product, readonly [number, number]> = {
  packageLengthMm: [500, 12000],
  packageWidthMinMm: [200, 4000],
  packageWidthMaxMm: [200, 4000],
  packageHeightMm: [100, 4000],
  packageWeightKg: [1, 20000],
  targetPackagesPerHour: [1, 200],
};

/** Ett heltal inom gränserna. */
export function clampTo(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Sätter ett paketmått inom gränserna. Virkesbredden är ett intervall: blir
 * minsta större än största följer den andra med, i stället för att lämna en
 * konfiguration som servern inte godtar.
 */
export function setProductValue(product: Product, key: keyof Product, value: number): void {
  product[key] = clampTo(value, PRODUCT_LIMITS[key]);
  if (key === "packageWidthMinMm" && product.packageWidthMinMm > product.packageWidthMaxMm) {
    product.packageWidthMaxMm = product.packageWidthMinMm;
  }
  if (key === "packageWidthMaxMm" && product.packageWidthMaxMm < product.packageWidthMinMm) {
    product.packageWidthMinMm = product.packageWidthMaxMm;
  }
}
