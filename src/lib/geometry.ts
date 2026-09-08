import type { Box, Dir, Rotation, Vec2 } from "./types";

export const DIR_VEC: Record<Dir, Vec2> = {
  "x+": { x: 1, y: 0 },
  "x-": { x: -1, y: 0 },
  "y+": { x: 0, y: 1 },
  "y-": { x: 0, y: -1 },
};

export function vecToDir(v: Vec2): Dir {
  if (v.x === 1) return "x+";
  if (v.x === -1) return "x-";
  if (v.y === 1) return "y+";
  return "y-";
}

/** Normaliserar −0 till 0 så att jämförelser och serialisering blir stabila. */
const nz = (v: number): number => (v === 0 ? 0 : v);

/** Rotation moturs i matematisk mening; i planvyn (Y nedåt) ser den medurs ut. */
export function rotatePoint(p: Vec2, rot: Rotation): Vec2 {
  switch (rot) {
    case 0:
      return { x: nz(p.x), y: nz(p.y) };
    case 90:
      return { x: nz(-p.y), y: nz(p.x) };
    case 180:
      return { x: nz(-p.x), y: nz(-p.y) };
    case 270:
      return { x: nz(p.y), y: nz(-p.x) };
  }
}

export function rotateDir(d: Dir, rot: Rotation): Dir {
  return vecToDir(rotatePoint(DIR_VEC[d], rot));
}

/** Spegling över maskinens längdaxel: y → width − y. */
export function mirrorPoint(p: Vec2, widthMm: number): Vec2 {
  return { x: p.x, y: widthMm - p.y };
}

export function mirrorDir(d: Dir): Dir {
  if (d === "y+") return "y-";
  if (d === "y-") return "y+";
  return d;
}

/** Höger­vektorn sett i riktningen d. Med Y nedåt i planvyn ger detta skärmens nedåtsida för d = x+. */
export function rightOf(d: Dir): Vec2 {
  return rotatePoint(DIR_VEC[d], 90);
}

export const ROTATIONS: Rotation[] = [0, 90, 180, 270];

/** Transformerar en lokal punkt till världen. */
export function toWorld(local: Vec2, opts: { origin: Vec2; rotation: Rotation; mirrored: boolean; widthMm: number }): Vec2 {
  const m = opts.mirrored ? mirrorPoint(local, opts.widthMm) : local;
  const r = rotatePoint(m, opts.rotation);
  return { x: opts.origin.x + r.x, y: opts.origin.y + r.y };
}

export function transformDir(d: Dir, opts: { rotation: Rotation; mirrored: boolean }): Dir {
  return rotateDir(opts.mirrored ? mirrorDir(d) : d, opts.rotation);
}

/** Axelparallell box för en lokal box efter transform. */
export function boxToWorld(
  local: Box,
  opts: { origin: Vec2; rotation: Rotation; mirrored: boolean; widthMm: number },
): Box {
  const corners: Vec2[] = [
    { x: local.x, y: local.y },
    { x: local.x + local.l, y: local.y },
    { x: local.x + local.l, y: local.y + local.w },
    { x: local.x, y: local.y + local.w },
  ].map((c) => toWorld(c, opts));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, l: Math.max(...xs) - minX, w: Math.max(...ys) - minY };
}

export function boxesOverlap(a: Box, b: Box, toleranceMm = 0): boolean {
  return (
    a.x + a.l - toleranceMm > b.x &&
    b.x + b.l - toleranceMm > a.x &&
    a.y + a.w - toleranceMm > b.y &&
    b.y + b.w - toleranceMm > a.y
  );
}

export function overlapAreaMm2(a: Box, b: Box): number {
  const dx = Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

export function boxContains(outer: Box, inner: Box, toleranceMm = 0): boolean {
  return (
    inner.x >= outer.x - toleranceMm &&
    inner.y >= outer.y - toleranceMm &&
    inner.x + inner.l <= outer.x + outer.l + toleranceMm &&
    inner.y + inner.w <= outer.y + outer.w + toleranceMm
  );
}

export function unionBox(boxes: Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, l: 0, w: 0 };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.l));
  const maxY = Math.max(...boxes.map((b) => b.y + b.w));
  return { x: minX, y: minY, l: maxX - minX, w: maxY - minY };
}

export function boxCenter(b: Box): Vec2 {
  return { x: b.x + b.l / 2, y: b.y + b.w / 2 };
}

/** Sant om segmentet a→b skär boxen (används för truckens åtkomstväg). */
export function segmentIntersectsBox(a: Vec2, b: Vec2, box: Box): boolean {
  const seg: Box = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    l: Math.abs(b.x - a.x),
    w: Math.abs(b.y - a.y),
  };
  if (!boxesOverlap(seg, box)) return false;
  // Axelparallella segment räcker för våra fall; annars kontrollera hörnens sida.
  if (a.x === b.x || a.y === b.y) return true;
  const side = (p: Vec2) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const s = [
    side({ x: box.x, y: box.y }),
    side({ x: box.x + box.l, y: box.y }),
    side({ x: box.x + box.l, y: box.y + box.w }),
    side({ x: box.x, y: box.y + box.w }),
  ];
  return !(s.every((v) => v > 0) || s.every((v) => v < 0));
}
