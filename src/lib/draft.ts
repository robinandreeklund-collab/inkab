import {
  closeCorners,
  fitDoorToWall,
  hallWalls,
  snapToWalls,
  WALL_THICKNESS_MM,
} from "./walls";
import { nextName } from "./drawing";
import type { Box, DrawnKind, DrawnObject, Vec2 } from "./types";
import type { ZoneId } from "./zones";

/**
 * Att rita en vägg, en port eller en zon.
 *
 * Geometrin låg förut inne i planvyn, och det gick bra så länge det bara
 * fanns ett ställe att rita på. Nu ritar man i modellvyn också, och då måste
 * reglerna bo utanför båda vyerna: en vägg som dras i 3D ska bli exakt samma
 * låda som om den dragits i planen — samma raster, samma rätning, samma
 * stängda hörn, samma namn i ordningen. Annars blir underlaget olika
 * beroende på vilken vy kunden råkade stå i, och det är ett fel man inte ser
 * förrän offerten är skickad.
 *
 * Vyerna står för pekaren och förhandsvisningen. Allt som avgör vad objektet
 * blir står här.
 */

/** Allt som ritas och dras snappar till detta raster, mm. */
export const DRAFT_SNAP_MM = 250;
/** Smalare än så är ett klick, inte ett objekt, mm. */
export const MIN_DRAFT_L = 200;
export const MIN_DRAFT_W = 100;

/** Väggarnas höjd när de ritas för hand, mm. Porten går högre än väggen. */
const WALL_HEIGHT_MM = 3000;
const DOOR_HEIGHT_MM = 5000;

/**
 * Höjden ett ritat objekt får, mm. Zoner är markeringar på golvet.
 *
 * Modellvyn behöver den redan under draget, så att förhandsvisningen står
 * lika hög som väggen blir när man släpper.
 */
export function draftHeight(kind: DrawnKind): number {
  return kind === "wall"
    ? WALL_HEIGHT_MM
    : kind === "door"
      ? DOOR_HEIGHT_MM
      : 0;
}

const snap = (v: number) => Math.round(v / DRAFT_SNAP_MM) * DRAFT_SNAP_MM;

type Hall = { lengthMm: number; widthMm: number };
type T = (key: string, vars?: Record<string, string | number>) => string;

/** Väggar en port kan sitta i: de ritade och hallens egna kanter. */
export const doorWalls = (walls: DrawnObject[], hall: Hall) => [
  ...walls,
  ...hallWalls(hall),
];

/**
 * Väggar och portar låses till närmaste axel så att de alltid blir raka —
 * man drar i grova drag åt det håll man menar och får en ren linje.
 * Zoner ritas som fria rektanglar.
 */
export function draftBox(
  kind: DrawnKind,
  from: Vec2,
  to: Vec2,
  walls: DrawnObject[] = [],
): Box {
  if (kind === "wall" || kind === "door") {
    // Ändarna dras till befintliga väggar så att linjerna möts där man siktar.
    from = snapToWalls(from, walls);
    to = snapToWalls(to, walls);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const half = WALL_THICKNESS_MM / 2;
    return Math.abs(dx) >= Math.abs(dy)
      ? {
          x: snap(Math.min(from.x, to.x)),
          y: snap(from.y) - half,
          l: Math.max(0, snap(Math.abs(dx))),
          w: WALL_THICKNESS_MM,
        }
      : {
          x: snap(from.x) - half,
          y: snap(Math.min(from.y, to.y)),
          l: WALL_THICKNESS_MM,
          w: Math.max(0, snap(Math.abs(dy))),
        };
  }
  return {
    x: snap(Math.min(from.x, to.x)),
    y: snap(Math.min(from.y, to.y)),
    l: Math.max(0, snap(Math.abs(to.x - from.x))),
    w: Math.max(0, snap(Math.abs(to.y - from.y))),
  };
}

/**
 * Färdigställer det ritade: väggar får sina hörn stängda, portar sätts in i
 * väggen de ritades på. Utan det blir en port en ruta på golvet och ett hörn
 * ett hål på en halv väggtjocklek.
 */
export function finishDraft(
  kind: DrawnKind,
  box: Box,
  walls: DrawnObject[],
  hall: Hall,
): Box {
  if (kind === "wall") return closeCorners(box, walls);
  if (kind === "door") return fitDoorToWall(box, doorWalls(walls, hall)) ?? box;
  return box;
}

/** Sant när draget är för kort för att vara något annat än ett klick. */
export function tooSmall(box: Box): boolean {
  return box.l < MIN_DRAFT_L || box.w < MIN_DRAFT_W;
}

/**
 * Lådan som visas medan man drar.
 *
 * En port visas där den kommer att hamna — i väggen — redan under draget, så
 * att avstånden till hörnen stämmer med resultatet.
 */
export function draftPreview(
  kind: DrawnKind,
  from: Vec2,
  to: Vec2,
  walls: DrawnObject[],
  hall: Hall,
): Box {
  const raw = draftBox(kind, from, to, walls);
  if (kind !== "door" || tooSmall(raw)) return raw;
  return fitDoorToWall(raw, doorWalls(walls, hall)) ?? raw;
}

/**
 * Det färdiga objektet av en förhandsvisad låda, eller null när draget var
 * för litet. Porten är redan insatt i väggen av draftPreview och sätts
 * därför inte in en gång till.
 */
export function commitDraft(
  kind: DrawnKind,
  box: Box,
  context: {
    /** Allt som redan är ritat — namnet tar sitt nummer ur det. */
    drawn: DrawnObject[];
    /** De ritade väggarna, för hörnen. */
    walls: DrawnObject[];
    hall: Hall;
    /** Zonsorten, när verktyget ritar en zon. */
    zone?: ZoneId;
    /** Kundens ordlista, så att zonen heter samma sak som knappen. */
    t?: T;
  },
): DrawnObject | null {
  if (tooSmall(box)) return null;
  const final =
    kind === "door" ? box : finishDraft(kind, box, context.walls, context.hall);
  const zone = kind === "zone" ? (context.zone ?? "other") : undefined;
  return {
    id: `${zone ?? kind}-${Date.now().toString(36)}`,
    kind,
    ...(zone ? { zone } : {}),
    name: nextName(kind, context.drawn, context.t, zone),
    x: Math.round(final.x),
    y: Math.round(final.y),
    l: Math.round(final.l),
    w: Math.round(final.w),
    h: draftHeight(kind),
  };
}
