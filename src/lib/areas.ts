import { DEFAULT_HALL, DEFAULT_PRODUCT } from "./templates";
import type { Configuration, LayoutResult } from "./types";

/**
 * Ytorna i konfiguratorn.
 *
 * Allt låg förut i en enda lång sidopanel, och den som kom dit visste varken
 * var hen var eller vad som skulle göras sedan. Nu är arbetet delat i ytor,
 * grupperade i den ordning de är lättast att göra: lokalen först, sedan
 * maskinerna, sedan flödet och sist offerten. Menyn till vänster visar var man
 * är och vad som är kvar; panelen till höger visar bara det som hör till ytan.
 *
 * Varje yta vet själv när den är klar, utifrån vad som faktiskt finns i
 * konfigurationen. Ytor som alltid har ett värde — hallen har ett mått från
 * början — kan bockas av för hand.
 */

export type Area =
  | "hall"
  | "walls"
  | "zones"
  | "machines"
  | "line"
  | "points"
  | "truck"
  | "product"
  | "quote";

export type AreaGroup = { id: "building" | "plant" | "flow" | "offer"; areas: Area[] };

export const AREA_GROUPS: AreaGroup[] = [
  { id: "building", areas: ["hall", "walls", "zones"] },
  { id: "plant", areas: ["machines", "line"] },
  { id: "flow", areas: ["points", "truck", "product"] },
  { id: "offer", areas: ["quote"] },
];

export const AREA_ORDER: Area[] = AREA_GROUPS.flatMap((g) => g.areas);

export function groupOf(area: Area): AreaGroup {
  return AREA_GROUPS.find((g) => g.areas.includes(area))!;
}

export function nextArea(area: Area): Area | null {
  const i = AREA_ORDER.indexOf(area);
  return AREA_ORDER[i + 1] ?? null;
}

export function previousArea(area: Area): Area | null {
  const i = AREA_ORDER.indexOf(area);
  return i > 0 ? AREA_ORDER[i - 1] : null;
}

/**
 * Ytor som kan bockas av för hand. Hallen har alltid ett mått, alla lokaler
 * har inte portar eller pelare, och paketets utgångsvärden kan vara de rätta
 * — där räcker det att kunden säger att det stämmer.
 *
 * Maskinerna och linjen avgörs bara av konfigurationen: att klicka vidare
 * från en linje med fel gör den inte felfri. Offerten är aldrig "klar".
 */
export const CONFIRMABLE: ReadonlySet<Area> = new Set<Area>(["hall", "walls", "zones", "points", "truck", "product"]);

/** Om ytan är klar, utifrån konfigurationen och det kunden själv bockat av. */
export function isAreaDone(
  area: Area,
  config: Configuration,
  layout: LayoutResult,
  confirmed: ReadonlySet<Area>,
): boolean {
  if (confirmed.has(area) && CONFIRMABLE.has(area)) return true;
  const has = (kind: string) => config.drawn.some((d) => d.kind === kind);
  switch (area) {
    case "hall":
      return (
        config.hall.lengthMm !== DEFAULT_HALL.lengthMm || config.hall.widthMm !== DEFAULT_HALL.widthMm
      );
    case "walls":
      return has("door");
    case "zones":
      return has("nogo");
    case "machines":
      return config.line.length > 0;
    case "line":
      return config.line.length > 0 && !layout.diagnostics.some((d) => d.severity === "error");
    case "points":
      return !!config.flow.startComment || (config.flow.markers?.length ?? 0) > 0;
    case "truck":
      return has("truck");
    case "product": {
      const p = config.product;
      return (Object.keys(DEFAULT_PRODUCT) as (keyof typeof p)[]).some((k) => p[k] !== DEFAULT_PRODUCT[k]);
    }
    case "quote":
      return false;
  }
}

/** Första ytan som inte är klar — den guiden pekar på som nästa steg. */
export function firstOpenArea(
  config: Configuration,
  layout: LayoutResult,
  confirmed: ReadonlySet<Area>,
): Area | null {
  return AREA_ORDER.find((a) => !isAreaDone(a, config, layout, confirmed)) ?? null;
}
