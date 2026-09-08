import type { Box, Vec2 } from "./types";

/** Isometrisk projektion, 30° — samma vy som en klassisk maskinuppställningsritning. */
export const ISO_COS = Math.cos(Math.PI / 6);
export const ISO_SIN = Math.sin(Math.PI / 6);

export function isoProject(x: number, y: number, z = 0): Vec2 {
  return { x: (x - y) * ISO_COS, y: (x + y) * ISO_SIN - z };
}

/** Inversen vid golvnivå (z = 0), för att kunna dra maskiner i 3D-vyn. */
export function isoUnproject(sx: number, sy: number): Vec2 {
  const a = sx / ISO_COS;
  const b = sy / ISO_SIN;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export type IsoFaces = { top: string; left: string; right: string; center: Vec2; depth: number };

/** De tre synliga sidorna av en låda, som SVG-polygonpunkter. */
export function isoBox(box: Box, heightMm: number): IsoFaces {
  const { x, y, l, w } = box;
  const h = Math.max(heightMm, 1);
  const p = (a: number, b: number, c: number) => {
    const q = isoProject(a, b, c);
    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  };
  const top = [p(x, y, h), p(x + l, y, h), p(x + l, y + w, h), p(x, y + w, h)];
  const bottom = [p(x, y, 0), p(x + l, y, 0), p(x + l, y + w, 0), p(x, y + w, 0)];

  return {
    top: top.join(" "),
    // Vänster synlig sida: längs +Y-kanten.
    left: [top[3], top[2], bottom[2], bottom[3]].join(" "),
    // Höger synlig sida: längs +X-kanten.
    right: [top[1], top[2], bottom[2], bottom[1]].join(" "),
    center: isoProject(x + l / 2, y + w / 2, h),
    depth: x + y + l / 2 + w / 2,
  };
}

/** Projicerad omslutande box, för att räkna ut SVG:ns viewBox i 3D-läget. */
export function isoBounds(box: Box, maxHeightMm: number): Box {
  const points: Vec2[] = [];
  for (const [a, b] of [
    [box.x, box.y],
    [box.x + box.l, box.y],
    [box.x + box.l, box.y + box.w],
    [box.x, box.y + box.w],
  ] as const) {
    points.push(isoProject(a, b, 0), isoProject(a, b, maxHeightMm));
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, l: Math.max(...xs) - minX, w: Math.max(...ys) - minY };
}

export function padBox(box: Box, padding: number): Box {
  return {
    x: box.x - padding,
    y: box.y - padding,
    l: box.l + padding * 2,
    w: box.w + padding * 2,
  };
}
