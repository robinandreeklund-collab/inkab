import type { Dimension, Vec2 } from "./types";

/**
 * Sparade mått på ritningen.
 *
 * Mätverktyget visar ett avstånd medan man drar, och förut försvann det när
 * man släppte. Men ett mått man har tagit är ofta just det man vill visa den
 * som läser ritningen: fritt mellan pelarna, avståndet till porten, bredden
 * på truckgatan. Här blir det en måttlinje som ligger kvar, följer med i
 * delningslänken och står i offertunderlaget och DXF-filen.
 */

/** Lika många som schemat tar emot. */
export const MAX_DIMENSIONS = 40;
/** Kortare än så är ett klick, inte ett mått, mm. */
export const MIN_DIMENSION_MM = 100;
/** Måtten avrundas till centimeter — mer än så säger inte en förstudie. */
const ROUND_MM = 10;

const round = (v: number) => Math.round(v / ROUND_MM) * ROUND_MM;

export function dimensionLength(d: { from: Vec2; to: Vec2 }): number {
  return Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y);
}

/**
 * Låser måttet till vågrätt eller lodrätt, åt det håll det redan lutar mest.
 * Det är nästan alltid det man menar när man mäter i en hall.
 */
export function straighten(from: Vec2, to: Vec2): Vec2 {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

let serial = 0;

/** Ett nytt mått, avrundat, eller null om det är för kort för att vara ett mått. */
export function makeDimension(from: Vec2, to: Vec2): Dimension | null {
  const a = { x: round(from.x), y: round(from.y) };
  const b = { x: round(to.x), y: round(to.y) };
  if (dimensionLength({ from: a, to: b }) < MIN_DIMENSION_MM) return null;
  serial += 1;
  return { id: `dim-${Date.now().toString(36)}-${serial.toString(36)}`, from: a, to: b };
}
