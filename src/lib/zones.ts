import type { DrawnObject } from "./types";

/**
 * Zonkatalogen.
 *
 * Förut fanns det två slags ytor i verktyget: truckgata och no-go. De låg
 * inbakade som egna objekttyper, och allt annat kunden ville markera i sin
 * hall — lagerytan, operatörsplatsen, elcentralen — fick bli en no-go-zon
 * med ett påhittat namn, och därmed ett fel i regelverket.
 *
 * Nu är en zon en zon. Objektet bär vilken sorts zon det är, och sorten står
 * här: vad den heter, hur den ritas och vad den betyder för reglerna. Att
 * lägga till en sort är en rad i listan, inte en ny gren genom tio filer.
 *
 * Två egenskaper räcker för regelverket:
 *   aisle    — trucken kör här. Ytan ska vara fri, och den räknas som
 *              truckgata i måtten och i reglerna R-105, R-203, R-404.
 *   blocking — en maskin som står här står fel. R-403 säger ifrån.
 *
 * En zon som varken är det ena eller det andra är en ren markering: den
 * syns i planen och följer med offerten, men den klagar aldrig.
 */

export type ZoneId =
  | "truck"
  | "nogo"
  | "storage"
  | "operator"
  | "service"
  | "electrical"
  | "foundation"
  | "other";

export type ZoneDefinition = {
  id: ZoneId;
  /** Nyckel i ordlistan: zone.<id> och zone.<id>.hint. */
  labelKey: string;
  hintKey: string;
  /** Konturens färg i planvyn. */
  stroke: string;
  /** Ytans färg, när zonen inte har ett eget raster. */
  tint: string;
  /** Raster i CadViews defs, för de två sorter som alltid haft ett. */
  pattern?: "aisleHatch" | "nogoHatch";
  /** Trucken kör här. */
  aisle: boolean;
  /** En maskin i zonen är ett fel. */
  blocking: boolean;
};

export const ZONES: readonly ZoneDefinition[] = [
  {
    id: "truck",
    labelKey: "zone.truck",
    hintKey: "zone.truck.hint",
    stroke: "#1d1f20",
    tint: "#1d1f20",
    pattern: "aisleHatch",
    aisle: true,
    blocking: false,
  },
  {
    id: "nogo",
    labelKey: "zone.nogo",
    hintKey: "zone.nogo.hint",
    stroke: "#9f1239",
    tint: "#9f1239",
    pattern: "nogoHatch",
    aisle: false,
    blocking: true,
  },
  {
    id: "storage",
    labelKey: "zone.storage",
    hintKey: "zone.storage.hint",
    stroke: "#b45309",
    tint: "#b45309",
    aisle: false,
    blocking: true,
  },
  {
    id: "operator",
    labelKey: "zone.operator",
    hintKey: "zone.operator.hint",
    stroke: "#5980a6",
    tint: "#5980a6",
    aisle: false,
    blocking: true,
  },
  {
    id: "service",
    labelKey: "zone.service",
    hintKey: "zone.service.hint",
    stroke: "#1d2d3d",
    tint: "#1d2d3d",
    aisle: false,
    blocking: true,
  },
  {
    id: "electrical",
    labelKey: "zone.electrical",
    hintKey: "zone.electrical.hint",
    stroke: "#7c3aed",
    tint: "#7c3aed",
    aisle: false,
    blocking: true,
  },
  {
    id: "foundation",
    labelKey: "zone.foundation",
    hintKey: "zone.foundation.hint",
    stroke: "#71717a",
    tint: "#71717a",
    aisle: false,
    blocking: false,
  },
  {
    id: "other",
    labelKey: "zone.other",
    hintKey: "zone.other.hint",
    stroke: "#71717a",
    tint: "#71717a",
    aisle: false,
    blocking: false,
  },
] as const;

const BY_ID = new Map<string, ZoneDefinition>(ZONES.map((z) => [z.id, z]));

/** Zonsorten, med "egen zon" som reserv för allt okänt. */
export function zoneDef(id: string | undefined): ZoneDefinition {
  return BY_ID.get(id ?? "") ?? BY_ID.get("other")!;
}

export function isZoneId(id: string): id is ZoneId {
  return BY_ID.has(id);
}

/** Zonsorten för ett ritat objekt, eller null om det är en vägg eller port. */
export function zoneOf(object: DrawnObject): ZoneDefinition | null {
  return object.kind === "zone" ? zoneDef(object.zone) : null;
}

/** Trucken kör här. */
export function isAisle(object: DrawnObject): boolean {
  return zoneOf(object)?.aisle === true;
}

/** En maskin som står här står fel: väggar, portar undantagna, och zoner som spärrar. */
export function blocksMachines(object: DrawnObject): boolean {
  if (object.kind === "wall") return true;
  if (object.kind === "door") return false;
  return zoneOf(object)?.blocking === true;
}

/**
 * Ett objekt sparat innan zonerna blev en katalog.
 *
 * `truck` och `nogo` var egna objekttyper. De lever vidare i delningslänkar,
 * i autosparade utkast och i sparade offerter, och ska fortsätta betyda
 * precis samma sak — alltså samma zonsorter under nytt tak.
 */
type LegacyDrawn = Omit<DrawnObject, "kind" | "zone"> & {
  kind: string;
  zone?: string;
};

export function migrateDrawn({
  zone,
  kind,
  ...rest
}: LegacyDrawn): DrawnObject {
  if (kind === "truck" || kind === "nogo")
    return { ...rest, kind: "zone", zone: kind };
  if (kind === "zone") return { ...rest, kind: "zone", zone: zoneDef(zone).id };
  return { ...rest, kind: kind === "door" ? "door" : "wall" };
}
