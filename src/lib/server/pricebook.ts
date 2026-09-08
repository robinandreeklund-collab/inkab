import "server-only";

/**
 * PRISBOK — LÄSES ENDAST PÅ SERVERN.
 *
 * "server-only" gör att bygget kraschar om en klientkomponent importerar den
 * här filen. Priser skickas aldrig i sin helhet till webbläsaren; klienten får
 * bara det aggregat som användarens roll tillåter (se pricing.ts).
 *
 * PLACEHOLDER-SIFFROR. Ersätt med INKAB:s verkliga prisbok.
 */

export type PriceEntry = {
  /** Listpris, SEK. */
  list: number;
  /** Internt inköpspris, SEK. Visas bara i säljläge. */
  cost: number;
  options: Record<string, number>;
};

export type PriceBook = {
  id: string;
  name: string;
  validFrom: string;
  validUntil: string;
  currency: "SEK";
  entries: Record<string, PriceEntry>;
  /** Påslag för montage, andel av maskinvärdet per kategori. */
  installFactor: Record<string, number>;
  /** Påslag för el och styrning, andel av totalt maskinvärde. */
  controlFactor: number;
  /** Schablonfrakt, SEK. */
  freight: number;
  /** Osäkerhetsintervall för publik prisindikation. */
  indicationSpread: { low: number; high: number };
};

export const PRICE_BOOK: PriceBook = {
  id: "2026-Q3",
  name: "Prisbok 2026-Q3",
  validFrom: "2026-07-01",
  validUntil: "2026-12-31",
  currency: "SEK",
  entries: {
    ib2: { list: 310_000, cost: 198_000, options: { "ib2-roll": 48_000 } },
    tt1: { list: 154_000, cost: 96_000, options: {} },
    pl3: { list: 1_460_000, cost: 940_000, options: { "pl3-servo": 92_000 } },
    ts4: { list: 1_074_000, cost: 690_000, options: { "ts4-fack": 34_000, "ts4-cam": 21_000 } },
    sr2: { list: 186_000, cost: 118_000, options: {} },
    pp1: { list: 465_000, cost: 298_000, options: {} },
    bm2: { list: 398_000, cost: 254_000, options: { "bm2-4band": 26_000 } },
    pk1: { list: 720_000, cost: 462_000, options: {} },
    kt: { list: 96_000, cost: 61_000, options: {} },
    rb: { list: 264_000, cost: 168_000, options: {} },
    ub1: { list: 228_000, cost: 146_000, options: {} },
    mp1: { list: 96_000, cost: 58_000, options: {} },
    sf3: { list: 74_000, cost: 44_000, options: {} },
  },
  installFactor: {
    infeed: 0.12,
    stacking: 0.18,
    stickers: 0.16,
    transport: 0.1,
    processing: 0.15,
    finishing: 0.12,
    outfeed: 0.1,
    control: 0.08,
  },
  controlFactor: 0.09,
  freight: 68_000,
  indicationSpread: { low: 0.87, high: 1.14 },
};
