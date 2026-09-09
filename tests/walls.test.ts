import { describe, expect, it } from "vitest";
import {
  closeCorners,
  fitDoorToWall,
  snapToWalls,
  wallEnds,
  WALL_THICKNESS_MM,
} from "@/lib/walls";
import type { DrawnObject } from "@/lib/types";

/**
 * Väggar som hänger ihop.
 *
 * Man ritar en linje — hit, och sedan ner — men väggen är en låda med
 * tjocklek. Utan hjälp möts de inte: det blir ett hål i hörnet på en halv
 * väggtjocklek.
 */

const wall = (x: number, y: number, l: number, w: number): DrawnObject => ({
  id: `w${x}${y}`,
  kind: "wall",
  name: "Vägg",
  x,
  y,
  l,
  w,
  h: 3000,
});

/** Vågrät vägg från (0,0) till (10000,0) på mittlinjen. */
const along = wall(0, -WALL_THICKNESS_MM / 2, 10_000, WALL_THICKNESS_MM);

describe("väggändar", () => {
  it("ger mittlinjens ändpunkter för en vågrät vägg", () => {
    expect(wallEnds(along)).toEqual([
      { x: 0, y: 0 },
      { x: 10_000, y: 0 },
    ]);
  });

  it("ger mittlinjens ändpunkter för en lodrät vägg", () => {
    const down = wall(-WALL_THICKNESS_MM / 2, 0, WALL_THICKNESS_MM, 8000);
    expect(wallEnds(down)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 8000 },
    ]);
  });
});

describe("fäst mot befintlig vägg", () => {
  it("drar punkten till närmaste ände", () => {
    // Man siktar i närheten av hörnet; väggen ska börja exakt där den andra
    // slutar, inte en halvmeter bredvid.
    expect(snapToWalls({ x: 9800, y: 300 }, [along])).toEqual({ x: 10_000, y: 0 });
  });

  it("låter en punkt långt bort vara", () => {
    expect(snapToWalls({ x: 20_000, y: 5000 }, [along])).toEqual({ x: 20_000, y: 5000 });
  });

  it("fäster mot mittlinjen när ingen ände är nära", () => {
    // Att greva av från mitten av en vägg ska också möta väggen.
    expect(snapToWalls({ x: 5000, y: 400 }, [along])).toEqual({ x: 5000, y: 0 });
  });

  it("väljer närmaste ände när flera finns", () => {
    const other = wall(19_000, -WALL_THICKNESS_MM / 2, 4000, WALL_THICKNESS_MM);
    expect(snapToWalls({ x: 18_600, y: 100 }, [along, other])).toEqual({ x: 19_000, y: 0 });
  });
});

describe("stäng hörnet", () => {
  it("förlänger den nya väggen där den möter en befintlig", () => {
    // Lodrät vägg som börjar i den vågrätas ände: utan förlängning blir det
    // ett hål på en halv väggtjocklek i hörnet.
    const down = { x: 10_000 - WALL_THICKNESS_MM / 2, y: 0, l: WALL_THICKNESS_MM, w: 6000 };
    const closed = closeCorners(down, [along]);
    expect(closed.y).toBe(-WALL_THICKNESS_MM / 2);
    expect(closed.w).toBe(6000 + WALL_THICKNESS_MM / 2);
  });

  it("rör inte en vägg som står för sig själv", () => {
    const free = { x: 30_000, y: 30_000, l: WALL_THICKNESS_MM, w: 6000 };
    expect(closeCorners(free, [along])).toEqual(free);
  });

  it("förlänger i båda ändar när båda möter", () => {
    const right = wall(20_000 - WALL_THICKNESS_MM / 2, 0, WALL_THICKNESS_MM, 5000);
    const bridge = { x: 10_000, y: -WALL_THICKNESS_MM / 2, l: 10_000, w: WALL_THICKNESS_MM };
    const closed = closeCorners(bridge, [along, right]);
    expect(closed.x).toBe(10_000 - WALL_THICKNESS_MM / 2);
    expect(closed.l).toBe(10_000 + WALL_THICKNESS_MM);
  });
});

describe("port i vägg", () => {
  it("lägger porten i väggen med väggens tjocklek", () => {
    const drawn = { x: 4000, y: 400, l: 2500, w: 900 };
    const fitted = fitDoorToWall(drawn, [along])!;
    expect(fitted.y).toBe(along.y);
    expect(fitted.w).toBe(along.w);
    expect(fitted.l).toBe(2500);
  });

  it("håller porten innanför väggens ändar", () => {
    // Ritad så att den skulle sticka ut förbi väggens ände.
    const drawn = { x: 8500, y: 200, l: 3000, w: 900 };
    const fitted = fitDoorToWall(drawn, [along])!;
    expect(fitted.x + fitted.l).toBeLessThanOrEqual(10_000);
    expect(fitted.l).toBeLessThan(3000);
  });

  it("ger null när ingen vägg är i närheten", () => {
    expect(fitDoorToWall({ x: 40_000, y: 40_000, l: 2000, w: 900 }, [along])).toBeNull();
  });

  it("klarar en lodrät vägg", () => {
    const down = wall(-WALL_THICKNESS_MM / 2, 0, WALL_THICKNESS_MM, 8000);
    const fitted = fitDoorToWall({ x: 300, y: 3000, l: 900, w: 2000 }, [down])!;
    expect(fitted.x).toBe(down.x);
    expect(fitted.l).toBe(down.l);
    expect(fitted.w).toBe(2000);
  });
});
