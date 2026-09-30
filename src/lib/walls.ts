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

/**
 * Hallens kanter som väggar.
 *
 * Den som inte ritat några väggar har ändå en hall, och en port hör hemma i
 * dess kant. Väggarna här ritas aldrig och sparas aldrig — de finns bara för
 * att portar ska kunna fästa i hallens kant och mäta sitt avstånd till hörnen.
 */
export function hallWalls(hall: { lengthMm: number; widthMm: number }): DrawnObject[] {
  const t = WALL_THICKNESS_MM;
  const half = t / 2;
  const wall = (id: string, box: Box): DrawnObject => ({ id, kind: "wall", name: "Hallens kant", h: 0, ...box });
  return [
    wall("hall-top", { x: -half, y: -half, l: hall.lengthMm + t, w: t }),
    wall("hall-bottom", { x: -half, y: hall.widthMm - half, l: hall.lengthMm + t, w: t }),
    wall("hall-left", { x: -half, y: -half, l: t, w: hall.widthMm + t }),
    wall("hall-right", { x: hall.lengthMm - half, y: -half, l: t, w: hall.widthMm + t }),
  ];
}

/** Portens fria avstånd längs väggen den sitter i, åt båda håll. */
export type DoorClearance = {
  /** Sant om väggen går i X-led. */
  alongX: boolean;
  /** Väggens mittlinje tvärs väggen, mm. */
  lineAt: number;
  /** Portens två kanter längs väggen, mm. */
  from: number;
  to: number;
  /** Närmaste hinder före och efter porten längs väggen, mm. */
  before: number;
  after: number;
};

/**
 * Hur långt det är från portens kanter till närmaste vägg på vardera sidan.
 *
 * Hindren är värdväggens egna ändar, väggar som går tvärs den (hörn och
 * mellanväggar, mätt till den sida som vetter mot porten) och andra portar i
 * samma vägg. Det är det fria måttet man behöver när man flyttar en port:
 * "två meter till hörnet, sex till nästa port".
 *
 * Null när porten inte sitter i någon vägg.
 */
export function doorClearance(
  door: Box,
  walls: DrawnObject[],
  others: Box[] = [],
): DoorClearance | null {
  const alongX = door.l >= door.w;
  const centre = { x: door.x + door.l / 2, y: door.y + door.w / 2 };
  const across = alongX ? centre.y : centre.x;
  const from = alongX ? door.x : door.y;
  const to = alongX ? door.x + door.l : door.y + door.w;

  // Värdväggen: parallell, täcker porten, och porten ligger på dess linje.
  const host = walls.find((wall) => {
    if (horizontal(wall) !== alongX) return false;
    const [a, b] = wallEnds(wall);
    const line = alongX ? a.y : a.x;
    const lo = alongX ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = alongX ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const thickness = alongX ? wall.w : wall.l;
    return Math.abs(line - across) <= thickness / 2 + 1 && from >= lo - 1 && to <= hi + 1;
  });
  if (!host) return null;

  const hostFrom = alongX ? host.x : host.y;
  const hostTo = alongX ? host.x + host.l : host.y + host.w;
  let before = hostFrom;
  let after = hostTo;

  const consider = (lo: number, hi: number) => {
    if (hi <= from + 1 && hi > before) before = hi;
    if (lo >= to - 1 && lo < after) after = lo;
  };

  for (const wall of walls) {
    if (wall === host || horizontal(wall) === alongX) continue;
    // En tvärvägg räknas bara om den faktiskt korsar eller möter värdväggens linje.
    const spanLo = alongX ? wall.y : wall.x;
    const spanHi = alongX ? wall.y + wall.w : wall.x + wall.l;
    if (across < spanLo - 1 || across > spanHi + 1) continue;
    consider(alongX ? wall.x : wall.y, alongX ? wall.x + wall.l : wall.y + wall.w);
  }

  for (const other of others) {
    if ((other.l >= other.w) !== alongX) continue;
    const otherAcross = alongX ? other.y + other.w / 2 : other.x + other.l / 2;
    if (Math.abs(otherAcross - across) > WALL_THICKNESS_MM) continue;
    consider(alongX ? other.x : other.y, alongX ? other.x + other.l : other.y + other.w);
  }

  return {
    alongX,
    lineAt: alongX ? host.y + host.w / 2 : host.x + host.l / 2,
    from,
    to,
    before: Math.max(0, from - before),
    after: Math.max(0, after - to),
  };
}

/**
 * Portar i hallens högra kant eller nederkant följer med när hallen ändras.
 *
 * En port i ytterväggen sitter i ytterväggen — drar man ut hallen ska den inte
 * bli kvar som en lös öppning mitt på golvet. Vänster- och överkanten ligger
 * fast på noll och flyttar sig aldrig.
 */
export function followHallEdges<T extends Box & { kind: string }>(
  drawn: T[],
  before: { lengthMm: number; widthMm: number },
  after: { lengthMm: number; widthMm: number },
): T[] {
  const dx = after.lengthMm - before.lengthMm;
  const dy = after.widthMm - before.widthMm;
  if (dx === 0 && dy === 0) return drawn;
  const near = (a: number, b: number) => Math.abs(a - b) <= WALL_THICKNESS_MM / 2 + 1;

  return drawn.map((object) => {
    if (object.kind !== "door") return object;
    const alongX = object.l >= object.w;
    if (alongX && dy !== 0 && near(object.y + object.w / 2, before.widthMm)) {
      return { ...object, y: object.y + dy };
    }
    if (!alongX && dx !== 0 && near(object.x + object.l / 2, before.lengthMm)) {
      return { ...object, x: object.x + dx };
    }
    return object;
  });
}
