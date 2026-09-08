import type { Configuration } from "./types";

/**
 * Underlagsnummer.
 *
 * Räknas fram ur konfigurationens innehåll, inte ur en räknare. Två
 * konsekvenser, båda avsiktliga: samma konfiguration ger alltid samma nummer,
 * så den som öppnar en delningslänk ser samma nummer som den som skickade den
 * — och ändras något i linjen får underlaget ett nytt nummer. Ett papper och
 * en konfiguration kan alltså inte glida isär i tysthet.
 *
 * Det är ett underlagsnummer, inte ett offertnummer. Offertnumret sätts i
 * affärssystemet när en säljare tar över.
 */

/** FNV-1a, 32 bitar. Vi behöver en kort stabil signatur, inte kryptografi. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Vad numret räknas på: anläggningen, inget annat.
 *
 * Kundfält och projektnamn står på pappret men ändrar ingen maskin, så de
 * lämnas utanför. Interna instans-id likaså — de slumpas när en maskin läggs
 * till, och skulle ge samma linje ett nytt nummer varje gång någon tog bort
 * och satte tillbaka en transportör.
 */
function signature(config: Configuration): string {
  return JSON.stringify({
    hall: config.hall,
    flow: config.flow,
    product: config.product,
    line: config.line.map((item) => ({
      machineId: item.machineId,
      selectedOptions: [...item.selectedOptions].sort(),
      parameters: item.parameters ?? null,
      manualOffset: item.manualOffset ?? null,
    })),
    drawn: config.drawn.map((d) => {
      const { id: _id, ...rest } = d;
      return rest;
    }),
  });
}

export function quoteReference(config: Configuration, date = new Date()): string {
  const year = date.getFullYear().toString().slice(2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  // Versaler och siffror, utan I/O/0/1 som läses fel i telefon.
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let value = fnv1a(signature(config));
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = alphabet[value % alphabet.length] + code;
    value = Math.floor(value / alphabet.length);
  }
  return `INKAB-${year}${month}-${code}`;
}

/** Giltighetstid för prisindikationen. */
export function validUntil(from = new Date(), days = 30): string {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
