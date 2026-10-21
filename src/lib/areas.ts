import { DEFAULT_HALL, DEFAULT_PRODUCT } from "./templates";
import type { Configuration, LayoutResult } from "./types";

/**
 * Stegen i konfiguratorn.
 *
 * Förut fanns nio ytor i fyra grupper, och grupperna var de verkliga
 * frågorna medan ytorna var block inuti dem. Mätaren sa "4 av 8 klara"
 * innan kunden gjort något, eftersom halva ytorna bockades av av sig
 * själva så fort en mall öppnades — och då betyder den ingenting.
 *
 * Nu finns tre steg som var och en kräver ett beslut av kunden, plus ett
 * valfritt. Varje steg ställer en fråga:
 *
 *   site     — hur ser lokalen ut? Mått, väggar, portar, zoner.
 *   plant    — vilka maskiner, var står de, var kommer paketen in?
 *   product  — vilka virkesdimensioner och vilken takt? Valfritt.
 *   quote    — sammanställningen och vägen att höra av sig.
 *
 * Innehållet är detsamma som förut; det är skärmarna som blivit färre.
 */

export type Area = "site" | "plant" | "product" | "quote";

export const AREA_ORDER: Area[] = ["site", "plant", "product", "quote"];

/**
 * Valfria steg räknas inte i förloppet.
 *
 * Paketet har rimliga utgångsvärden som de flesta kunder aldrig rör. Ett
 * steg som nästan alltid lämnas orört drar ner mätaren utan att säga något
 * om hur långt kunden kommit.
 */
export const OPTIONAL: ReadonlySet<Area> = new Set<Area>(["product"]);

/**
 * Steg kunden kan bocka av genom att gå vidare.
 *
 * Bara lokalen: en mall gissar hallens mått, och kunden som tittat på
 * gissningen och tyckt att den duger har gjort steget. Anläggningen avgörs
 * av konfigurationen — ett klick gör inte en linje med fel felfri — och
 * offerten är aldrig "klar".
 */
export const CONFIRMABLE: ReadonlySet<Area> = new Set<Area>(["site"]);

/** Stegen som räknas i mätaren, i ordning. */
export const COUNTED: Area[] = AREA_ORDER.filter((a) => !OPTIONAL.has(a));

/** Numret i menyn, eller null för ett valfritt steg. */
export function areaNumber(area: Area): number | null {
  const i = COUNTED.indexOf(area);
  return i < 0 ? null : i + 1;
}

export function nextArea(area: Area): Area | null {
  return AREA_ORDER[AREA_ORDER.indexOf(area) + 1] ?? null;
}

export function previousArea(area: Area): Area | null {
  const i = AREA_ORDER.indexOf(area);
  return i > 0 ? AREA_ORDER[i - 1] : null;
}

/** Om steget är klart, utifrån konfigurationen och det kunden bockat av. */
export function isAreaDone(
  area: Area,
  config: Configuration,
  layout: LayoutResult,
  confirmed: ReadonlySet<Area>,
): boolean {
  switch (area) {
    case "site":
      /*
       * En mall gissar hallens mått och sår en hämtzon. Att räkna det som
       * att kunden gjort steget vore precis det fel mätaren ska bli av med:
       * steget är gjort när måttet ändrats eller kunden sagt att det stämmer.
       */
      if (confirmed.has("site")) return true;
      return (
        config.hall.lengthMm !== DEFAULT_HALL.lengthMm ||
        config.hall.widthMm !== DEFAULT_HALL.widthMm
      );
    case "plant":
      return (
        config.line.length > 0 &&
        !layout.diagnostics.some((d) => d.severity === "error")
      );
    case "product": {
      const p = config.product;
      return (Object.keys(DEFAULT_PRODUCT) as (keyof typeof p)[]).some(
        (k) => p[k] !== DEFAULT_PRODUCT[k],
      );
    }
    case "quote":
      return false;
  }
}

/** Första steget som inte är klart. Valfria steg står aldrig i vägen. */
export function firstOpenArea(
  config: Configuration,
  layout: LayoutResult,
  confirmed: ReadonlySet<Area>,
): Area | null {
  return COUNTED.find((a) => !isAreaDone(a, config, layout, confirmed)) ?? null;
}

/**
 * Ett steg sparat innan de nio ytorna blev tre.
 *
 * En kund som återvänder till sitt arbete ska hamna i steget där ytan hen
 * senast arbetade i ligger, inte kastas tillbaka till början.
 */
const LEGACY: Record<string, Area> = {
  hall: "site",
  walls: "site",
  zones: "site",
  machines: "plant",
  line: "plant",
  points: "plant",
  truck: "site",
  product: "product",
  quote: "quote",
};

export function migrateArea(value: string): Area | null {
  if (AREA_ORDER.includes(value as Area)) return value as Area;
  return LEGACY[value] ?? null;
}
