/**
 * Språken sajten finns på.
 *
 * Svenska är källspråket: texterna skrivs här först, och en nyckel som saknar
 * översättning faller tillbaka på den. Hellre ett svenskt ord mitt i en tysk
 * mening än en tom ruta — det syns, och då blir det rättat.
 */
export const LOCALES = ["sv", "en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABEL: Record<Locale, string> = {
  sv: "Svenska",
  en: "English",
  de: "Deutsch",
};

/** Kort etikett för växlaren i sidhuvudet. */
export const LOCALE_SHORT: Record<Locale, string> = {
  sv: "SV",
  en: "EN",
  de: "DE",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Språket webbläsaren ber om, när kunden inte valt något.
 *
 * `navigator.languages` är i fallande ordning, så den första träffen är den
 * kunden helst läser. Bara språkdelen jämförs: "de-AT" är tyska.
 */
export function preferredLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.split("-")[0]?.toLowerCase();
    if (isLocale(base)) return base;
  }
  return "sv";
}
