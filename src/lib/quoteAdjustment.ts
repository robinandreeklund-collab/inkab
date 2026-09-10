/**
 * Justering av en offert.
 *
 * Listpriset kommer ur prisboken och är samma för alla. Den enskilda affären är
 * det inte: en kund får rabatt för att linjen är lång, en annan för att den
 * ligger bra i beläggningen, och ibland sätts totalen rakt av i en förhandling.
 *
 * Justeringen hör därför till offerten och inte till prisboken — den ska gälla
 * just det här underlaget och inte flytta priserna för alla andra. Den lagras
 * på förslaget, räknas på servern och syns i offerten som en egen rad. En
 * rabatt som inte står utskriven är inte en rabatt utan ett annat pris.
 */

export type QuoteAdjustment = {
  /** Avdrag i procent på totalen, 0–100. */
  discountPercent?: number;
  /** Fast totalpris som ersätter det uträknade. Går före rabatten. */
  fixedTotalSek?: number;
  /** Varför. Står i offerten. */
  note?: string;
};

export type AdjustmentResult = {
  /** Uträknat pris ur prisboken, före justering. */
  listSek: number;
  /** Att betala. */
  finalSek: number;
  /** Avdraget i kronor, positivt när priset sänkts. */
  deltaSek: number;
  discountPercent: number;
  fixedTotalSek: number | null;
  note: string;
  /** Sant när något faktiskt ändrats. */
  applied: boolean;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Städar det som kommer in från formuläret innan det sparas. */
export function normaliseAdjustment(raw: QuoteAdjustment | null | undefined): QuoteAdjustment {
  if (!raw) return {};
  const out: QuoteAdjustment = {};

  if (typeof raw.discountPercent === "number" && Number.isFinite(raw.discountPercent)) {
    const percent = Math.round(clamp(raw.discountPercent, 0, 100) * 10) / 10;
    if (percent > 0) out.discountPercent = percent;
  }
  if (typeof raw.fixedTotalSek === "number" && Number.isFinite(raw.fixedTotalSek)) {
    const fixed = Math.round(clamp(raw.fixedTotalSek, 0, 1_000_000_000));
    if (fixed > 0) out.fixedTotalSek = fixed;
  }
  if (typeof raw.note === "string" && raw.note.trim()) out.note = raw.note.trim().slice(0, 300);

  return out;
}

/**
 * Räknar fram vad kunden ska betala.
 *
 * Ett fast pris går före rabatten: sätter någon totalen i en förhandling är
 * det den siffran som gäller, och att sedan dra procent på den vore att
 * förhandla två gånger.
 */
export function applyAdjustment(
  listSek: number,
  raw: QuoteAdjustment | null | undefined,
): AdjustmentResult {
  const adjustment = normaliseAdjustment(raw);
  const discountPercent = adjustment.discountPercent ?? 0;
  const fixedTotalSek = adjustment.fixedTotalSek ?? null;

  const finalSek =
    fixedTotalSek !== null
      ? fixedTotalSek
      : Math.round(listSek * (1 - discountPercent / 100));

  return {
    listSek,
    finalSek,
    deltaSek: listSek - finalSek,
    discountPercent,
    fixedTotalSek,
    note: adjustment.note ?? "",
    applied: finalSek !== listSek || !!adjustment.note,
  };
}

/** Hur justeringen skrivs i offerten. */
export function adjustmentLabel(result: AdjustmentResult): string {
  if (result.fixedTotalSek !== null) return "Avtalat totalpris";
  if (result.discountPercent > 0) return `Avdrag ${String(result.discountPercent).replace(".", ",")} %`;
  return "Justering";
}
