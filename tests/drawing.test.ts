import { describe, expect, it } from "vitest";
import { MAX_DRAWN, planToDrawn, wallFromLine } from "@/lib/drawing";
import { WALL_THICKNESS_MM } from "@/lib/walls";
import type { DrawnObject } from "@/lib/types";

/**
 * Uppläst ritning → ritade objekt.
 *
 * Det som testas är att en uppmätt bild behandlas precis som en människas
 * handritning: väggarna rätas och möts, portarna hamnar i väggen, och allt som
 * inte gick att göra kommer tillbaka som en anteckning i stället för att tyst
 * försvinna.
 */

const HALL = { lengthMm: 46000, widthMm: 22500 };

describe("wallFromLine", () => {
  it("ger en vågrät vägg tjocklek kring sin mittlinje", () => {
    const wall = wallFromLine({ x: 0, y: 5000 }, { x: 20000, y: 5000 })!;
    expect(wall.box).toEqual({ x: 0, y: 5000 - WALL_THICKNESS_MM / 2, l: 20000, w: WALL_THICKNESS_MM });
    expect(wall.skewMm).toBe(0);
  });

  it("rätar en sned linje till närmaste axel och säger hur snett den låg", () => {
    const wall = wallFromLine({ x: 0, y: 0 }, { x: 20000, y: 600 })!;
    expect(wall.box.w).toBe(WALL_THICKNESS_MM);
    expect(wall.box.y).toBe(300 - WALL_THICKNESS_MM / 2);
    expect(wall.skewMm).toBe(600);
  });

  it("vänder på det när linjen mest går tvärs", () => {
    const wall = wallFromLine({ x: 3000, y: 0 }, { x: 3200, y: 9000 })!;
    expect(wall.box.l).toBe(WALL_THICKNESS_MM);
    expect(wall.box.w).toBe(9000);
  });

  it("ger ingen vägg av en punkt", () => {
    expect(wallFromLine({ x: 0, y: 0 }, { x: 200, y: 100 })).toBeNull();
  });
});

describe("planToDrawn", () => {
  it("syr ihop hörnet mellan två väggar som slutar i samma punkt", () => {
    const { drawn } = planToDrawn(
      {
        walls: [
          { from: { x: 0, y: 0 }, to: { x: 20000, y: 0 } },
          { from: { x: 20000, y: 0 }, to: { x: 20000, y: 10000 } },
        ],
      },
      HALL,
    );

    expect(drawn).toHaveLength(2);
    const [along, across] = drawn;
    expect(along.l).toBe(20000);
    // Den andra väggen förlängs en halv tjocklek in i hörnet i stället för
    // att lämna ett hål.
    expect(across.y).toBe(-WALL_THICKNESS_MM / 2);
    expect(across.w).toBe(10000 + WALL_THICKNESS_MM / 2);
  });

  it("sätter porten i väggen den ritades vid", () => {
    const { drawn, notes } = planToDrawn(
      {
        walls: [{ from: { x: 0, y: 0 }, to: { x: 40000, y: 0 } }],
        doors: [{ at: { x: 10000, y: 0 }, widthMm: 4000 }],
      },
      HALL,
    );

    const door = drawn.find((d) => d.kind === "door")!;
    const wall = drawn.find((d) => d.kind === "wall")!;
    expect(door.y).toBe(wall.y);
    expect(door.w).toBe(wall.w);
    expect(door.l).toBe(4000);
    expect(door.x).toBe(8000);
    expect(notes).toHaveLength(0);
  });

  it("säger ifrån när en port inte hittar någon vägg", () => {
    const { drawn, notes } = planToDrawn(
      { doors: [{ at: { x: 10000, y: 8000 }, widthMm: 4000 }] },
      HALL,
    );
    expect(drawn).toHaveLength(1);
    expect(notes.join(" ")).toContain("inte i någon vägg");
  });

  it("namnger i samma serie som det som redan är ritat", () => {
    const existing: DrawnObject[] = [
      { id: "w1", kind: "wall", name: "Vägg 1", x: 0, y: 0, l: 1000, w: 300, h: 3000 },
    ];
    const { drawn } = planToDrawn(
      { walls: [{ from: { x: 0, y: 9000 }, to: { x: 9000, y: 9000 } }] },
      HALL,
      existing,
    );
    expect(drawn[0].name).toBe("Vägg 2");
  });

  it("drar in punkter utanför hallen och säger till", () => {
    const { drawn, notes } = planToDrawn(
      { walls: [{ from: { x: 0, y: 3000 }, to: { x: 90000, y: 3000 } }] },
      HALL,
    );
    expect(drawn[0].l).toBe(HALL.lengthMm);
    expect(notes.join(" ")).toContain("utanför hallens mått");
  });

  it("ritar inte en vägg som är kortare än en halvmeter, men nämner den", () => {
    const { drawn, notes } = planToDrawn(
      { walls: [{ from: { x: 0, y: 0 }, to: { x: 300, y: 0 } }] },
      HALL,
    );
    expect(drawn).toHaveLength(0);
    expect(notes.join(" ")).toContain("kortare");
  });

  it("ritar truck- och no-go-zoner som rektanglar", () => {
    const { drawn } = planToDrawn(
      {
        areas: [
          { kind: "nogo", name: "Pelare", box: { x: 12000, y: 6000, l: 800, w: 800 } },
          { kind: "truck", box: { x: 0, y: 18000, l: 40000, w: 4000 } },
        ],
      },
      HALL,
    );
    expect(drawn.map((d) => d.kind)).toEqual(["nogo", "truck"]);
    expect(drawn[0].name).toBe("Pelare");
    expect(drawn[1].name).toBe("Truckzon 1");
  });

  it("håller sig inom taket på antal ritade objekt", () => {
    const walls = Array.from({ length: 100 }, (_, i) => ({
      from: { x: 0, y: i * 200 },
      to: { x: 5000, y: i * 200 },
    }));
    const { drawn, notes } = planToDrawn({ walls }, HALL);
    expect(drawn).toHaveLength(MAX_DRAWN);
    expect(notes.join(" ")).toContain(String(MAX_DRAWN));
  });
});
