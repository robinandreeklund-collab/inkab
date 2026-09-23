import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { effectiveMachine, solveLayout } from "@/lib/solver";
import { BUILTIN_MACHINES, getMachine, makeLibrary } from "@/lib/library";
import { defaultConfig, lineItem, templateConfig } from "@/lib/templates";
import type { Configuration } from "@/lib/types";

const clone = (c: Configuration): Configuration => JSON.parse(JSON.stringify(c));

describe("kedjevandring", () => {
  it("ritar ut varje maskins portar i hallens koordinater", () => {
    // Portarna kopplar ingenting längre — de är pilar som säger åt vilket
    // håll maskinen tar emot och lämnar. De måste därför ligga på maskinen.
    const layout = solveLayout(defaultConfig());
    const line = layout.placements.filter((p) => !p.aux);
    expect(line.length).toBeGreaterThan(2);

    for (const p of line) {
      for (const port of p.ports) {
        expect(port.pos.x).toBeGreaterThanOrEqual(p.bbox.x - 1);
        expect(port.pos.x).toBeLessThanOrEqual(p.bbox.x + p.bbox.l + 1);
        expect(port.pos.y).toBeGreaterThanOrEqual(p.bbox.y - 1);
        expect(port.pos.y).toBeLessThanOrEqual(p.bbox.y + p.bbox.w + 1);
      }
    }
  });

  it("är deterministisk", () => {
    const config = defaultConfig();
    const a = solveLayout(config);
    const b = solveLayout(clone(config));
    expect(a.placements.map((p) => p.bbox)).toEqual(b.placements.map((p) => p.bbox));
  });

  it("lägger maskinerna i följd längs hallen", () => {
    const line = solveLayout(defaultConfig())
      .placements.filter((p) => !p.aux)
      .sort((a, b) => a.pos - b.pos);
    for (let i = 0; i < line.length - 1; i++) {
      expect(line[i + 1].bbox.x).toBeGreaterThanOrEqual(line[i].bbox.x);
    }
  });
});

describe("hallen och truckgatorna", () => {
  it("truckgatan kommer från det kunden ritat, inte från linjens längd", () => {
    const config = defaultConfig();
    const before = solveLayout(config);
    expect(before.aisles).toHaveLength(1);

    // Fler maskiner ska inte ändra truckzonen.
    config.line.splice(1, 0, lineItem("rullbana"));
    const after = solveLayout(config);
    expect(after.aisles[0].box).toEqual(before.aisles[0].box);

    // Tas zonen bort finns ingen truckgata alls.
    config.drawn = config.drawn.filter((d) => d.kind !== "truck");
    expect(solveLayout(config).aisles).toHaveLength(0);
  });

  it("flera hämtzoner hanteras samtidigt", () => {
    const config = defaultConfig();
    config.drawn.push({
      id: "truck-2",
      kind: "truck",
      name: "Hämtzon 2",
      x: 2000,
      y: 200,
      l: 6000,
      w: 4500,
      h: 0,
    });
    expect(solveLayout(config).aisles).toHaveLength(2);
  });

  it("längden sätts per maskin, inte av en flödesfråga", () => {
    const short = defaultConfig();
    short.line.find((i) => i.machineId === "kedjetransportor")!.lengthMm = 6000;
    const long = defaultConfig();
    long.line.find((i) => i.machineId === "kedjetransportor")!.lengthMm = 18000;

    const kt = (c: typeof short) =>
      solveLayout(c).placements.find((p) => p.machineId === "kedjetransportor")!;
    expect(kt(short).size.lengthMm).toBe(6000);
    expect(kt(long).size.lengthMm).toBe(18000);
  });

  it("respekterar min- och maxlängd för parametriska maskiner", () => {
    const config = defaultConfig();
    config.line.find((i) => i.machineId === "kedjetransportor")!.lengthMm = 59000;
    const kt = solveLayout(config).placements.find((p) => p.machineId === "kedjetransportor")!;
    expect(kt.size.lengthMm).toBe(getMachine("kedjetransportor")!.parametricLength!.maxMm);
  });
});

describe("optioner", () => {
  it("breddar maskinen och flyttar portarna", () => {
    const machine = getMachine("tsl-enkel")!;
    const base = effectiveMachine(machine, []);
    const wide = effectiveMachine(machine, ["magasin-stort"]);
    expect(wide.effWidthMm).toBe(base.effWidthMm + 900);
  });

  it("påverkar kapacitet och effekt", () => {
    const multi = getMachine("tsl-multi")!;
    const withLift = effectiveMachine(multi, ["vakuumlyft-extra"]);
    expect(withLift.effLengthMm).toBe(multi.footprint.lengthMm + 1200);
    expect(withLift.effPowerKw).toBeCloseTo(multi.utilities.powerKw + 2.5, 5);
  });
});

describe("mätvärden", () => {
  it("hittar flaskhalsen", () => {
    const layout = computeLayout(defaultConfig());
    expect(layout.metrics.bottleneck).not.toBeNull();
    expect(layout.metrics.throughputPerHour).toBe(layout.metrics.bottleneck!.capacity);
  });

  it("summerar effekt över alla maskiner", () => {
    const layout = computeLayout(defaultConfig());
    const sum = layout.placements.reduce((a, p) => a + p.powerKw, 0);
    expect(layout.metrics.totalPowerKw).toBeCloseTo(Math.round(sum * 10) / 10, 5);
  });
});

/**
 * Fri placering.
 *
 * Maskinerna kopplades förut ihop port mot port och en solver räknade fram
 * var var och en hamnade. Nu står maskinen där kunden ställt den, och att
 * flytta en granne rör ingen annan.
 */
describe("fri placering", () => {
  it("lägger maskinen exakt där positionen säger", () => {
    const config = defaultConfig();
    const target = config.line[1];
    target.pos = { x: 20000, y: 8000 };
    const at = solveLayout(config).placements.find((p) => p.instanceId === target.instanceId)!;
    expect(at.bbox.x).toBe(20000);
    expect(at.bbox.y).toBe(8000);
  });

  it("låter grannarna stå kvar när en maskin flyttas", () => {
    const config = defaultConfig();
    const before = solveLayout(config);
    const target = config.line[1];
    target.pos = { x: 30000, y: 15000 };
    const after = solveLayout(config);

    for (const p of before.placements) {
      if (p.instanceId === target.instanceId) continue;
      const nu = after.placements.find((q) => q.instanceId === p.instanceId)!;
      expect(nu.bbox).toEqual(p.bbox);
    }
  });

  it("vrider maskinen efter sin rotation", () => {
    const config = defaultConfig();
    const target = config.line[0];
    target.pos = { x: 5000, y: 5000 };
    const rakt = solveLayout(config).placements.find((p) => p.instanceId === target.instanceId)!;
    target.rotation = 90;
    const vriden = solveLayout(config).placements.find((p) => p.instanceId === target.instanceId)!;
    expect(vriden.bbox.l).toBeCloseTo(rakt.bbox.w, 5);
    expect(vriden.bbox.w).toBeCloseTo(rakt.bbox.l, 5);
  });

  it("ger en post utan position en plats på ledig yta", () => {
    const config = defaultConfig();
    for (const item of config.line) delete item.pos;
    const solved = solveLayout(config);
    expect(solved.unplaced).toEqual([]);
    expect(solved.placements.every((p) => p.bbox.x > 0)).toBe(true);
  });
});

describe("tom och trasig indata", () => {
  it("klarar en tom linje", () => {
    const layout = computeLayout({ ...defaultConfig(), line: [] });
    expect(layout.placements).toHaveLength(0);
    expect(layout.metrics.throughputPerHour).toBe(0);
  });

  it("ignorerar okända maskin-id", () => {
    const config = defaultConfig();
    config.line.push(lineItem("finns-inte"));
    expect(() => computeLayout(config)).not.toThrow();
  });
});

describe("maskinzonen gäller per sida", () => {
  /*
   * Zonen räknades tidigare som en kvadratisk marginal med det största av de
   * fyra måtten åt alla håll. En rullbana med 0,8 m åt sidorna fick då 0,8 m
   * framåt fast fram är 0,4, och det knuffade nästnästa maskin i kedjan en
   * halvmeter bort — utan att något i gränssnittet kunde förklara varför.
   */
  const rullbana = BUILTIN_MACHINES.find((m) => m.id === "rullbana")!;
  const sides = { backMm: 400, frontMm: 400, leftMm: 800, rightMm: 800 };

  const line = (ids: string[]): Configuration => {
    const template = templateConfig("strolinje");
    return {
      ...template,
      line: ids.map((machineId, i) => ({
        instanceId: `i${i}`,
        machineId,
        selectedOptions: [],
      })),
    };
  };

  const library = makeLibrary(
    BUILTIN_MACHINES.map((m) => {
      // Modell så att den steglösa längden inte tar över måttet.
      if (m.id === "rullbana")
        return {
          ...m,
          clearance: sides,
          model: { glb: "/x" },
          footprint: { lengthMm: 3000, widthMm: 1600, heightMm: 600 },
          ports: m.ports.map((p) => ({
            ...p,
            pos: { x: p.role === "in" ? 0 : 3000, y: 800 },
          })),
        };
      return m;
    }),
  );

  it("låter sidozonen vara utan att ändra maskinens egen box", () => {
    // Zonen är bredare än maskinen, men maskinens kropp är maskinens mått.
    const layout = computeLayout(line(["rullbana", "rullbana", "rullbana"]), library);
    for (const p of layout.placements) {
      expect(p.bbox.l).toBe(3000);
      expect(p.bbox.w).toBe(1600);
    }
  });

  it("håller kvar sidozonen i geometrin", () => {
    // Zonen ska finnas och vara bredare än maskinen — den ska bara inte
    // räknas som ett hinder framåt.
    const placement = computeLayout(line(["rullbana"]), library).placements[0];
    const zone = placement.zones.find((z) => z.type === "clearance")!;
    expect(zone.box.w).toBe(1600 + sides.leftMm + sides.rightMm);
    expect(zone.box.l).toBe(3000 + sides.frontMm + sides.backMm);
  });
});
