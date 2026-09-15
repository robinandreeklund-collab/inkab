/**
 * Produktbilderna, från canvas till biblioteksdokument.
 *
 * Bilderna komprimeras i webbläsaren innan de läggs i dokumentet, och där
 * finns en fälla: `canvas.toDataURL("image/webp")` är en önskan, inte ett
 * löfte. Stöder webbläsaren inte formatet ska den enligt HTML-standarden ge
 * en PNG i stället — utan att säga något. Koden som tog webp för givet
 * märkte alltså PNG-byte som webp, och en PNG på en produktbild är ofta
 * flera megabyte där webp hade varit några hundra kilobyte. Bilden föll då
 * på storleksgränsen, eller kom fram med fel typ och vägrade visas.
 *
 * Därför frågar vi inte vad vi bad om, utan läser vad vi fick.
 */

/** Typerna biblioteksdokumentet tar emot. */
export const ASSET_MIMES = ["image/webp", "image/jpeg", "image/png"] as const;
export type AssetMime = (typeof ASSET_MIMES)[number];

/** Typen webbläsaren faktiskt kodade till, ur data-URI:ns huvud. */
export function mimeOfDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match ? match[1] : "";
}

/** Base64-delen, utan prefix. */
export function base64OfDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? "" : dataUrl.slice(comma + 1);
}

/** Råstorleken i byte för base64 utan prefix. */
export function byteSize(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export type EncodedImage = { mime: AssetMime; data: string; bytes: number };

/**
 * Väljer den minsta kodningen webbläsaren klarade.
 *
 * Kandidaterna är data-URI:er ur samma canvas. Den som är minst vinner, så
 * länge dess faktiska typ är en biblioteket accepterar — en webbläsare utan
 * webp lämnar tillbaka PNG, och då är JPEG-kandidaten oftast mindre.
 */
export function chooseImage(dataUrls: string[]): EncodedImage | null {
  let best: EncodedImage | null = null;

  for (const dataUrl of dataUrls) {
    const mime = mimeOfDataUrl(dataUrl);
    if (!(ASSET_MIMES as readonly string[]).includes(mime)) continue;

    const data = base64OfDataUrl(dataUrl);
    if (!data) continue;

    const candidate: EncodedImage = { mime: mime as AssetMime, data, bytes: byteSize(data) };
    if (!best || candidate.bytes < best.bytes) best = candidate;
  }

  return best;
}
