import type { Box, DrawnObject, Vec2 } from "./types";

/**
 * Väggar som hänger ihop.
 *
 * En vägg ritas som en låda med en tjocklek, men det man tänker på när man
 * ritar är en linje: hit, och sedan ner. Två sådana linjer möts inte av sig
 * själva — det blir ett hål i hörnet på en halv väggtjocklek, och man får
 * pilla med koordinater för att stänga det.
 *
 * Här dras ändpunkterna i stället till varandra, och hörnet fylls genom att
 * båda väggarna förlängs en halv tjocklek. Portar sätts in i väggen de ritas
 * på i stället för att bli en egen låda bredvid.
 */

/** Väggtjocklek, mm. Samma i hela verktyget. */
export const WALL_THICKNESS_MM = 300;
/** Hur nära man behöver komma för att en ände ska fästa, mm. */
export const SNAP_REACH_MM = 900;

const horizontal = (o: { l: number; w: number }) => o.l >= o.w;

/** Mittlinjens två ändpunkter. */
export function wallEnds(o: Box): [Vec2, Vec2] {
  return horizontal(o)
    ? [
        { x: o.x, y: Math.round(o.y + o.w / 2) },
        { x: o.x + o.l, y: Math.round(o.y + o.w / 2) },
      ]
    : [
        { x: Math.round(o.x + o.l / 2), y: o.y },
        { x: Math.round(o.x + o.l / 2), y: o.y + o.w },
      ];
}

/**
 * Drar en punkt till närmaste väggände inom räckhåll.
 *
 * Ändarna först, sedan mittlinjen: att fästa i en ände är nästan alltid det
 * man menar när man ritar vidare, medan mittlinjen fångar en vägg man vill
 * greva av från.
 */
export function snapToWalls(
  point: Vec2,
  walls: DrawnObject[],
  reach = SNAP_REACH_MM,
): Vec2 {
  let best: { point: Vec2; distance: number } | null = null;
  const consider = (candidate: Vec2) => {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= reach && (!best || distance < best.distance)) {
      best = { point: candidate, distance };
    }
  };

  for (const wall of walls) {
    const [a, b] = wallEnds(wall);
    consider(a);
    consider(b);
  }
  if (best) return (best as { point: Vec2 }).point;

  // Ingen ände nära: fäst mot en mittlinje så att väggen ändå möter väggen.
  for (const wall of walls) {
    const [a, b] = wallEnds(wall);
    if (a.y === b.y && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)) {
      if (Math.abs(point.y - a.y) <= reach) return { x: point.x, y: a.y };
    }
    if (a.x === b.x && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) {
      if (Math.abs(point.x - a.x) <= reach) return { x: a.x, y: point.y };
    }
  }

  return point;
}

/**
 * Förlänger en ny vägg en halv tjocklek där den möter en befintlig, så att
 * hörnet blir fyllt i stället för att lämna ett hål.
 */
export function closeCorners(box: Box, walls: DrawnObject[]): Box {
  const half = Math.round(WALL_THICKNESS_MM / 2);
  const [start, end] = wallEnds(box);
  const meets = (point: Vec2) =>
    walls.some((wall) => wallEnds(wall).some((e) => e.x === point.x && e.y === point.y));

  const result = { ...box };
  if (horizontal(box)) {
    if (meets(start)) {
      result.x -= half;
      result.l += half;
    }
    if (meets(end)) result.l += half;
  } else {
    if (meets(start)) {
      result.y -= half;
      result.w += half;
    }
    if (meets(end)) result.w += half;
  }
  return result;
}

/**
 * Sätter in en port i väggen den ritas på.
 *
 * En port utan vägg är bara en ruta på golvet. Ritas den nära en vägg tar den
 * väggens riktning, läge och tjocklek — det är en öppning i väggen, inte ett
 * objekt bredvid den.
 */
export function fitDoorToWall(box: Box, walls: DrawnObject[], reach = SNAP_REACH_MM): Box | null {
  const centre = { x: box.x + box.l / 2, y: box.y + box.w / 2 };

  let best: { wall: DrawnObject; distance: number } | null = null;
  for (const wall of walls) {
    const [a, b] = wallEnds(wall);
    const along = a.y === b.y;
    const inside = along
      ? centre.x >= Math.min(a.x, b.x) && centre.x <= Math.max(a.x, b.x)
      : centre.y >= Math.min(a.y, b.y) && centre.y <= Math.max(a.y, b.y);
    if (!inside) continue;
    const distance = along ? Math.abs(centre.y - a.y) : Math.abs(centre.x - a.x);
    if (distance <= reach && (!best || distance < best.distance)) best = { wall, distance };
  }
  if (!best) return null;

  const wall = (best as { wall: DrawnObject }).wall;
  const [a, b] = wallEnds(wall);

  if (a.y === b.y) {
    const width = Math.max(500, Math.round(box.l));
    const from = Math.max(Math.min(a.x, b.x), Math.round(centre.x - width / 2));
    const to = Math.min(Math.max(a.x, b.x), from + width);
    return { x: from, y: wall.y, l: Math.max(500, to - from), w: wall.w };
  }

  const height = Math.max(500, Math.round(box.w));
  const from = Math.max(Math.min(a.y, b.y), Math.round(centre.y - height / 2));
  const to = Math.min(Math.max(a.y, b.y), from + height);
  return { x: wall.x, y: from, l: wall.l, w: Math.max(500, to - from) };
}
