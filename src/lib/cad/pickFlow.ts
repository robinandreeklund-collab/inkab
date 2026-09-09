import type { Vec2 } from "@/lib/types";

/**
 * Flödet definierat på maskinen i stället för på filens axlar.
 *
 * Att härleda flödet ur CAD-axlarna fungerar så länge alla filer följer samma
 * konvention. En fil som inte gör det ger fel flöde, och då återstår att skriva
 * in portkoordinater för hand — vilket kräver att man tänker i maskinens lokala
 * system i stället för att titta på maskinen.
 *
 * Här pekar man i stället ut var paketen kommer in och var de går ut. Ur de två
 * punkterna följer allt annat: vilken väg maskinen ska vändas, och var portarna
 * sitter. Är riktningen tvärs mot den ritade blir det ett kvarts varv, och då
 * byter längd och bredd plats.
 */

export type FlowPick = {
  /** Vridning som ska läggas till modellens nuvarande, i grader. */
  yawDelta: 0 | 90 | 180 | 270;
  /** Sant när vridningen byter längd mot bredd. */
  swapsFootprint: boolean;
  /** Portlägen i maskinens system efter vridningen, mm. */
  inPos: Vec2;
  outPos: Vec2;
  footprint: { lengthMm: number; widthMm: number };
};

/**
 * @param inPoint  punkt på modellen där paketen kommer in, maskinkoordinater mm
 * @param outPoint punkt där de går ut
 * @param footprint maskinens mått som modellen är ritad med
 */
export function flowFromPicks(
  inPoint: Vec2,
  outPoint: Vec2,
  footprint: { lengthMm: number; widthMm: number },
): FlowPick {
  const { lengthMm: L, widthMm: W } = footprint;
  const dx = outPoint.x - inPoint.x;
  const dy = outPoint.y - inPoint.y;

  /*
   * Vridningarna är härledda ur samma rotation som uppritningen använder,
   * Ry(θ), och kontrollerade mot den i testet. Ett kvarts varv lägger den
   * tvärgående axeln längs flödet, så längd och bredd byter plats.
   */
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      return {
        yawDelta: 0,
        swapsFootprint: false,
        inPos: { ...inPoint },
        outPos: { ...outPoint },
        footprint: { lengthMm: L, widthMm: W },
      };
    }
    const flip = (p: Vec2): Vec2 => ({ x: L - p.x, y: W - p.y });
    return {
      yawDelta: 180,
      swapsFootprint: false,
      inPos: flip(inPoint),
      outPos: flip(outPoint),
      footprint: { lengthMm: L, widthMm: W },
    };
  }

  if (dy > 0) {
    const turn = (p: Vec2): Vec2 => ({ x: p.y, y: L - p.x });
    return {
      yawDelta: 90,
      swapsFootprint: true,
      inPos: turn(inPoint),
      outPos: turn(outPoint),
      footprint: { lengthMm: W, widthMm: L },
    };
  }

  const turn = (p: Vec2): Vec2 => ({ x: W - p.y, y: p.x });
  return {
    yawDelta: 270,
    swapsFootprint: true,
    inPos: turn(inPoint),
    outPos: turn(outPoint),
    footprint: { lengthMm: W, widthMm: L },
  };
}

/** Lägger till en vridning och håller den inom ett varv. */
export function addYaw(
  current: 0 | 90 | 180 | 270 | undefined,
  delta: 0 | 90 | 180 | 270,
): 0 | 90 | 180 | 270 {
  return (((current ?? 0) + delta) % 360) as 0 | 90 | 180 | 270;
}

/**
 * Drar portläget ut till närmaste kortsida.
 *
 * Man klickar på maskinen där paketet passerar, inte exakt på kanten. En port
 * hör till kanten, så punkten flyttas dit — och hamnar den i mitten av en
 * lång maskin är det värt att säga till om, inte att gissa bort.
 */
export function snapToEdge(
  pos: Vec2,
  footprint: { lengthMm: number; widthMm: number },
  role: "in" | "out",
): Vec2 {
  return {
    x: role === "in" ? 0 : footprint.lengthMm,
    y: Math.min(footprint.widthMm, Math.max(0, Math.round(pos.y))),
  };
}
