import { describe, expect, it } from "vitest";
import { doorClearance, fitDoorToWall, followHallEdges, hallWalls, WALL_THICKNESS_MM } from "@/lib/walls";
import type { DrawnObject } from "@/lib/types";

/**
 * Portens avstånd till närmaste vägg.
 *
 * Den som flyttar en port vill veta hur långt det är till hörnet åt båda håll
 * — det fria måttet, från portens kant till väggens insida.
 */

const T = WALL_THICKNESS_MM;
const HALL = { lengthMm: 40_000, widthMm: 20_000 };

describe("hallens kanter som väggar", () => {
  it("ger fyra väggar centrerade på hallens kanter", () => {
    const walls = hallWalls(HALL);
    expect(walls).toHaveLength(4);
    expect(walls[0]).toMatchObject({ x: -T / 2, y: -T / 2, l: HALL.lengthMm + T, w: T });
  });

  it("låter en port fästa i hallens kant när inga väggar är ritade", () => {
    const door = fitDoorToWall({ x: 9000, y: 19_600, l: 4000, w: 500 }, hallWalls(HALL));
    expect(door).toEqual({ x: 9000, y: HALL.widthMm - T / 2, l: 4000, w: T });
  });
});

describe("doorClearance", () => {
  const walls = hallWalls(HALL);
  const door = { x: 10_000, y: HALL.widthMm - T / 2, l: 4000, w: T };

  it("mäter till hörnens insida på båda sidor", () => {
    const c = doorClearance(door, walls)!;
    expect(c.alongX).toBe(true);
    expect(c.before).toBe(10_000 - T / 2);
    expect(c.after).toBe(HALL.lengthMm - T / 2 - 14_000);
  });

  it("räknar en mellanvägg som går ut från väggen", () => {
    const inner: DrawnObject = {
      id: "mellan",
      kind: "wall",
      name: "Mellanvägg",
      x: 20_000 - T / 2,
      y: 5000,
      l: T,
      w: HALL.widthMm - 5000,
      h: 3000,
    };
    const c = doorClearance(door, [...walls, inner])!;
    expect(c.after).toBe(20_000 - T / 2 - 14_000);
  });

  it("räknar en annan port i samma vägg", () => {
    const other = { x: 4000, y: door.y, l: 3000, w: T };
    const c = doorClearance(door, walls, [other])!;
    expect(c.before).toBe(10_000 - 7000);
  });

  it("fungerar för en lodrät vägg", () => {
    const side = { x: -T / 2, y: 6000, l: T, w: 4000 };
    const c = doorClearance(side, walls)!;
    expect(c.alongX).toBe(false);
    expect(c.before).toBe(6000 - T / 2);
    expect(c.after).toBe(HALL.widthMm - T / 2 - 10_000);
  });

  it("ger null för en port utan vägg", () => {
    expect(doorClearance({ x: 10_000, y: 10_000, l: 4000, w: T }, walls)).toBeNull();
  });
});

describe("portar följer hallens kant", () => {
  const T2 = WALL_THICKNESS_MM / 2;
  const bottom = { id: "a", kind: "door", x: 10_000, y: HALL.widthMm - T2, l: 4000, w: WALL_THICKNESS_MM };
  const right = { id: "b", kind: "door", x: HALL.lengthMm - T2, y: 5000, l: WALL_THICKNESS_MM, w: 4000 };
  const top = { id: "c", kind: "door", x: 10_000, y: -T2, l: 4000, w: WALL_THICKNESS_MM };
  const wall = { id: "d", kind: "wall", x: 0, y: HALL.widthMm - T2, l: 5000, w: WALL_THICKNESS_MM };

  it("flyttar portar i nederkant och högerkant, men inte annat", () => {
    const moved = followHallEdges([bottom, right, top, wall], HALL, { lengthMm: 45_000, widthMm: 23_000 });
    expect(moved[0].y).toBe(23_000 - T2);
    expect(moved[1].x).toBe(45_000 - T2);
    expect(moved[2]).toBe(top);
    expect(moved[3]).toBe(wall);
  });
});
