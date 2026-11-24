import { describe, expect, it } from "vitest";
import {
  commitDraft,
  draftHeight,
  draftPreview,
  DRAFT_SNAP_MM,
  MIN_DRAFT_L,
  tooSmall,
} from "@/lib/draft";
import { WALL_THICKNESS_MM } from "@/lib/walls";
import type { DrawnObject } from "@/lib/types";

/**
 * Att rita en vägg, en port eller en zon.
 *
 * Geometrin låg förut inne i planvyn. Nu ritar modellvyn med samma
 * funktioner, och det som testas här är just det: att resultatet bara beror
 * på draget — inte på vilken vy man råkade stå i. Varje prov nedan motsvarar
 * ett drag som båda vyerna gör likadant.
 */

const HALL = { lengthMm: 40000, widthMm: 20000 };
const ctx = (drawn: DrawnObject[] = []) => ({
  drawn,
  walls: drawn.filter((d) => d.kind === "wall"),
  hall: HALL,
});

/** En vägg som redan står i ritningen. */
const wall = (box: {
  x: number;
  y: number;
  l: number;
  w: number;
}): DrawnObject => ({
  id: "w1",
  kind: "wall",
  name: "Vägg 1",
  h: 3000,
  ...box,
});

describe("draftPreview", () => {
  it("rätar ett snett drag till en vågrät vägg kring sin mittlinje", () => {
    const box = draftPreview(
      "wall",
      { x: 1000, y: 5000 },
      { x: 13000, y: 5400 },
      [],
      HALL,
    );
    expect(box).toEqual({
      x: 1000,
      y: 5000 - WALL_THICKNESS_MM / 2,
      l: 12000,
      w: WALL_THICKNESS_MM,
    });
  });

  it("snappar zonens hörn till rastret och godtar vilken rektangel som helst", () => {
    const box = draftPreview(
      "zone",
      { x: 2100, y: 3900 },
      { x: 9040, y: 11010 },
      [],
      HALL,
    );
    for (const v of [box.x, box.y, box.l, box.w])
      expect(v % DRAFT_SNAP_MM).toBe(0);
    expect(box).toEqual({ x: 2000, y: 4000, l: 7000, w: 7000 });
  });

  it("sätter porten i väggen redan under draget", () => {
    const host = wall({ x: 0, y: 8000, l: 20000, w: WALL_THICKNESS_MM });
    const box = draftPreview(
      "door",
      { x: 5000, y: 8600 },
      { x: 9000, y: 8600 },
      [host],
      HALL,
    );
    // Porten tar väggens läge och tjocklek, inte pekarens.
    expect(box.y).toBe(host.y);
    expect(box.w).toBe(host.w);
    expect(box.l).toBeGreaterThanOrEqual(MIN_DRAFT_L);
  });

  it("sätter porten i hallens kant när ingen vägg är ritad", () => {
    const box = draftPreview(
      "door",
      { x: 12000, y: 600 },
      { x: 16000, y: 600 },
      [],
      HALL,
    );
    expect(box.w).toBe(WALL_THICKNESS_MM);
    expect(box.y).toBeLessThanOrEqual(0);
  });
});

describe("commitDraft", () => {
  it("ger ett klick inget objekt", () => {
    const box = draftPreview(
      "zone",
      { x: 4000, y: 4000 },
      { x: 4050, y: 4050 },
      [],
      HALL,
    );
    expect(tooSmall(box)).toBe(true);
    expect(commitDraft("zone", box, ctx())).toBeNull();
  });

  it("namnger zonen per sort och bär sorten vidare", () => {
    const first = commitDraft(
      "zone",
      { x: 0, y: 0, l: 6000, w: 4000 },
      { ...ctx(), zone: "storage" },
    )!;
    expect(first.zone).toBe("storage");
    expect(first.name).toBe("Lageryta 1");

    const second = commitDraft(
      "zone",
      { x: 0, y: 6000, l: 6000, w: 4000 },
      { ...ctx([first]), zone: "storage" },
    )!;
    expect(second.name).toBe("Lageryta 2");

    // Truckzonerna räknas för sig: en ny sort börjar om på ett.
    const truck = commitDraft(
      "zone",
      { x: 0, y: 12000, l: 6000, w: 4000 },
      { ...ctx([first, second]), zone: "truck" },
    )!;
    expect(truck.name).toBe("Truckzon 1");
  });

  it("stänger hörnet mot väggen den möter", () => {
    // Båda väggarna dras som kunden drar dem: den första vågrätt, den andra
    // nedåt från dess ände — nära nog, inte exakt.
    const first = commitDraft(
      "wall",
      draftPreview(
        "wall",
        { x: 2000, y: 5000 },
        { x: 12000, y: 5120 },
        [],
        HALL,
      ),
      ctx(),
    )!;
    expect(first.name).toBe("Vägg 1");

    const second = commitDraft(
      "wall",
      draftPreview(
        "wall",
        { x: 11800, y: 5300 },
        { x: 12000, y: 14000 },
        [first],
        HALL,
      ),
      ctx([first]),
    )!;
    // Den nya väggen förlängs en halv tjocklek upp i hörnet i stället för att
    // lämna ett hål på en halv väggtjocklek där de möts.
    expect(second.y).toBe(5000 - WALL_THICKNESS_MM / 2);
    expect(second.name).toBe("Vägg 2");
  });

  it("ger väggen höjd och zonen ingen", () => {
    expect(draftHeight("wall")).toBe(3000);
    expect(draftHeight("door")).toBe(5000);
    expect(draftHeight("zone")).toBe(0);
    const zone = commitDraft(
      "zone",
      { x: 0, y: 0, l: 4000, w: 4000 },
      { ...ctx(), zone: "nogo" },
    )!;
    expect(zone.h).toBe(0);
  });

  it("ger samma objekt oavsett vilken vy draget kom från", () => {
    // Två identiska drag, ett "ur planen" och ett "ur modellen": allt utom
    // id:t, som är en tidsstämpel, ska vara lika.
    const from = { x: 3000, y: 5000 };
    const to = { x: 17000, y: 5000 };
    const plan = commitDraft(
      "wall",
      draftPreview("wall", from, to, [], HALL),
      ctx(),
    )!;
    const model = commitDraft(
      "wall",
      draftPreview("wall", from, to, [], HALL),
      ctx(),
    )!;
    const { id: _a, ...planRest } = plan;
    const { id: _b, ...modelRest } = model;
    expect(modelRest).toEqual(planRest);
  });
});
