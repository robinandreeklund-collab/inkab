import "server-only";

/**
 * PRISBOK — LÄSES ENDAST PÅ SERVERN.
 *
 * "server-only" gör att bygget kraschar om en klientkomponent importerar den
 * här filen. Priser skickas aldrig i sin helhet till webbläsaren; klienten får
 * bara det aggregat som användarens roll tillåter (se pricing.ts).
 *
 * Detta är utgångsläget. Den prisbok som faktiskt används läses via
 * store.ts och kan redigeras i admin-vyn.
 *
 * PLACEHOLDER-SIFFROR. Ersätt med INKAB:s verkliga prisbok.
 */

export type PriceEntry = {
  /** Listpris, SEK. */
  list: number;
  /** Internt inköpspris, SEK. Visas bara i säljläge. */
  cost: number;
  options: Record<string, number>;
  /**
   * Pris per utförande. Ersätter grundpriset när det finns — en tolvmeters
   * rullbana kostar inte samma som en tremeters. Saknas posten gäller
   * grundpriset, så ett nytt utförande fungerar innan priset är satt.
   */
  variants?: Record<string, { list: number; cost: number }>;
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

export const BUILTIN_PRICE_BOOK: PriceBook = {
  id: "2026-Q3",
  name: "Prisbok 2026-Q3",
  validFrom: "2026-07-01",
  validUntil: "2026-12-31",
  currency: "SEK",
  entries: {
    // PLACEHOLDER-PRISER. Katalogen anger inga priser — ersätt med INKAB:s egna.
    "tsl-enkel": { list: 1_180_000, cost: 742_000, options: { "magasin-stort": 96_000 } },
    "tsl-multi": { list: 2_240_000, cost: 1_420_000, options: { "vakuumlyft-extra": 268_000 } },
    underslagslaggare: { list: 1_340_000, cost: 855_000, options: { "separat-magasin": 184_000 } },
    "rullbana-underslag": { list: 640_000, cost: 402_000, options: {} },
    "paketlyft-fast": { list: 720_000, cost: 448_000, options: {} },
    "paketlyft-vagn": { list: 985_000, cost: 618_000, options: {} },
    sidoskyddslaggare: { list: 890_000, cost: 562_000, options: {} },
    "paketpress-hydraulisk": { list: 745_000, cost: 468_000, options: {} },
    lattpress: { list: 268_000, cost: 168_000, options: {} },
    emballageutlaggare: { list: 690_000, cost: 436_000, options: {} },
    rullbana: { list: 74_000, cost: 47_000, options: {} },
    kedjetransportor: { list: 96_000, cost: 61_000, options: {} },
    "kedjekanal-hojsank": { list: 386_000, cost: 244_000, options: {} },
    bandomforing: { list: 246_000, cost: 154_000, options: {} },
    "bandomforing-spjut": { list: 342_000, cost: 214_000, options: {} },
    strofacksmagasin: { list: 74_000, cost: 44_000, options: {} },
    manoverpulpet: { list: 168_000, cost: 104_000, options: {} },
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
