import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { effectiveMachine, solveLayout } from "@/lib/solver";
import { getMachine } from "@/lib/library";
import { defaultConfig, lineItem, templateConfig } from "@/lib/templates";
import type { Configuration } from "@/lib/types";

const clone = (c: Configuration): Configuration => JSON.parse(JSON.stringify(c));

describe("kedjevandring", () => {
  it("kopplar ihop utport med nästa inport utan glapp", () => {
    const layout = solveLayout(defaultConfig());
    const line = layout.placements.filter((p) => !p.aux).sort((a, b) => a.pos - b.pos);
    expect(line.length).toBeGreaterThan(2);

    for (let i = 0; i < line.length - 1; i++) {
      const out = line[i].ports.find((p) => p.role === "out")!;
      const next = line[i + 1].ports.find((p) => p.role === "in")!;
      expect(Math.hypot(out.pos.x - next.pos.x, out.pos.y - next.pos.y)).toBeLessThan(1);
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

describe("de fem flödesfrågorna påverkar geometrin", () => {
  it("infeed från sidan utan tvärtransportör flaggas", () => {
    const config = defaultConfig();
    config.flow.infeedFrom = "right";
    const layout = solveLayout(config);
    expect(layout.neverTurnedToMainAxis).toBe(true);
    expect(computeLayout(config).diagnostics.some((d) => d.code === "R-102")).toBe(true);
  });

  it("controlDeskSide flyttar pulpeten till motsatt sida", () => {
    const right = solveLayout(defaultConfig());
    const leftConfig = defaultConfig();
    leftConfig.flow.controlDeskSide = "left";
    const left = solveLayout(leftConfig);

    const deskOf = (l: typeof right) => l.placements.find((p) => p.machineId === "manoverpulpet")!;
    expect(deskOf(right).bbox.y).not.toBe(deskOf(left).bbox.y);
  });

  it("stickerMagazineSide flyttar magasinet", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    b.flow.stickerMagazineSide = "left";
    const magA = solveLayout(a).placements.find((p) => p.machineId === "strofacksmagasin")!;
    const magB = solveLayout(b).placements.find((p) => p.machineId === "strofacksmagasin")!;
    expect(magA.bbox.y).toBeGreaterThan(magB.bbox.y);
  });

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

  it("finalConveyorLengthMm ändrar både geometri och totallängd", () => {
    const short = defaultConfig();
    short.flow.finalConveyorLengthMm = 6000;
    const long = defaultConfig();
    long.flow.finalConveyorLengthMm = 18000;

    const shortLayout = solveLayout(short);
    const longLayout = solveLayout(long);
    const kt = (l: typeof shortLayout) => l.placements.find((p) => p.machineId === "kedjetransportor")!;

    expect(kt(shortLayout).size.lengthMm).toBe(6000);
    expect(kt(longLayout).size.lengthMm).toBe(18000);
    expect(longLayout.metrics.totalLengthMm - shortLayout.metrics.totalLengthMm).toBe(12000);
  });

  it("respekterar min- och maxlängd för parametriska maskiner", () => {
    const config = defaultConfig();
    config.flow.finalConveyorLengthMm = 99000;
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

describe("manuell justering", () => {
  it("flyttar maskinen utan att riva resten av kedjan", () => {
    const config = defaultConfig();
    const target = config.line[1];
    const before = solveLayout(config);
    target.manualOffset = { x: 0, y: 3000 };
    const after = solveLayout(config);

    const at = (l: typeof before, id: string) => l.placements.find((p) => p.instanceId === id)!;
    expect(at(after, target.instanceId).bbox.y - at(before, target.instanceId).bbox.y).toBe(3000);

    const last = config.line[3];
    expect(at(after, last.instanceId).bbox).toEqual(at(before, last.instanceId).bbox);
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
