import { describe, expect, it } from "vitest";
import {
  boxToWorld,
  boxesOverlap,
  mirrorDir,
  rightOf,
  rotateDir,
  rotatePoint,
  segmentIntersectsBox,
  transformDir,
} from "@/lib/geometry";

describe("rotation", () => {
  it("roterar punkter i 90-graderssteg", () => {
    expect(rotatePoint({ x: 10, y: 0 }, 90)).toEqual({ x: 0, y: 10 });
    expect(rotatePoint({ x: 10, y: 0 }, 180)).toEqual({ x: -10, y: 0 });
    expect(rotatePoint({ x: 10, y: 0 }, 270)).toEqual({ x: 0, y: -10 });
  });

  it("roterar riktningar konsekvent", () => {
    expect(rotateDir("x+", 90)).toBe("y+");
    expect(rotateDir("x+", 270)).toBe("y-");
    expect(rotateDir("y+", 90)).toBe("x-");
  });

  it("fyra rotationer om 90 grader ger identitet", () => {
    let d: ReturnType<typeof rotateDir> = "x+";
    for (let i = 0; i < 4; i++) d = rotateDir(d, 90);
    expect(d).toBe("x+");
  });
});

describe("spegling", () => {
  it("vänder bara tvärriktningar", () => {
    expect(mirrorDir("y+")).toBe("y-");
    expect(mirrorDir("y-")).toBe("y+");
    expect(mirrorDir("x+")).toBe("x+");
  });

  it("kombinerar spegling och rotation", () => {
    expect(transformDir("y+", { rotation: 0, mirrored: true })).toBe("y-");
    expect(transformDir("y+", { rotation: 90, mirrored: true })).toBe("x+");
  });
});

describe("höger­vektor", () => {
  it("pekar mot +Y när flödet går mot +X", () => {
    expect(rightOf("x+")).toEqual({ x: 0, y: 1 });
    expect(rightOf("y-")).toEqual({ x: 1, y: 0 });
  });
});

describe("boxar", () => {
  it("roterar en box till korrekt AABB", () => {
    const b = boxToWorld(
      { x: 0, y: 0, l: 4000, w: 2000 },
      { origin: { x: 1000, y: 1000 }, rotation: 90, mirrored: false, widthMm: 2000 },
    );
    expect(b).toEqual({ x: -1000, y: 1000, l: 2000, w: 4000 });
  });

  it("upptäcker överlapp men inte beröring", () => {
    const a = { x: 0, y: 0, l: 100, w: 100 };
    expect(boxesOverlap(a, { x: 50, y: 50, l: 100, w: 100 })).toBe(true);
    expect(boxesOverlap(a, { x: 100, y: 0, l: 100, w: 100 })).toBe(false);
  });

  it("hittar segment som korsar en box", () => {
    const box = { x: 40, y: 0, l: 20, w: 100 };
    expect(segmentIntersectsBox({ x: 0, y: 50 }, { x: 100, y: 50 }, box)).toBe(true);
    expect(segmentIntersectsBox({ x: 0, y: 50 }, { x: 30, y: 50 }, box)).toBe(false);
  });
});

describe("isometrisk projektion", () => {
  it("är inverterbar vid golvnivå", async () => {
    const { isoProject, isoUnproject } = await import("@/lib/projection");
    const p = isoProject(12345, 6789, 0);
    const back = isoUnproject(p.x, p.y);
    expect(back.x).toBeCloseTo(12345, 6);
    expect(back.y).toBeCloseTo(6789, 6);
  });

  it("höjd flyttar punkten uppåt i bild", async () => {
    const { isoProject } = await import("@/lib/projection");
    expect(isoProject(0, 0, 1000).y).toBeLessThan(isoProject(0, 0, 0).y);
  });

  it("djupsortering följer avstånd från betraktaren", async () => {
    const { isoBox } = await import("@/lib/projection");
    const near = isoBox({ x: 0, y: 0, l: 1000, w: 1000 }, 500);
    const far = isoBox({ x: 9000, y: 9000, l: 1000, w: 1000 }, 500);
    expect(far.depth).toBeGreaterThan(near.depth);
  });
});
