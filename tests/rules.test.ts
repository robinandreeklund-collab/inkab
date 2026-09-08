import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { defaultConfig, lineItem, templateConfig } from "@/lib/templates";

const codes = (c: Parameters<typeof computeLayout>[0]) =>
  computeLayout(c).diagnostics.map((d) => d.code);

describe("regelmotorn", () => {
  it("standardmallen ger inga fel", () => {
    const layout = computeLayout(templateConfig("strolinje"));
    const errors = layout.diagnostics.filter((d) => d.severity === "error");
    expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0);
  });

  it("R-401 när linjen inte får plats i hallen", () => {
    const config = defaultConfig();
    config.hall.lengthMm = 15000;
    expect(codes(config)).toContain("R-401");
  });

  it("R-402 när en maskin är högre än hallen", () => {
    const config = defaultConfig();
    config.hall.clearHeightMm = 3000;
    expect(codes(config)).toContain("R-402");
  });

  it("R-403 när en maskin står i en ritad no-go-zon", () => {
    const config = defaultConfig();
    const layout = computeLayout(config);
    const target = layout.placements[1].bbox;
    config.drawn.push({
      id: "z1",
      kind: "nogo",
      name: "No-go · pelarrad",
      x: target.x + 200,
      y: target.y + 200,
      l: 2000,
      w: 2000,
      h: 0,
    });
    expect(codes(config)).toContain("R-403");
  });

  it("R-501 när en maskin saknar sitt beroende", () => {
    const config = defaultConfig();
    config.line = config.line.filter((i) => i.machineId !== "sr2");
    const diagnostics = computeLayout(config).diagnostics;
    const missing = diagnostics.find((d) => d.code === "R-501");
    expect(missing).toBeDefined();
    expect(missing!.fix).toEqual({
      kind: "addMachine",
      machineId: "sr2",
      label: "Lägg till Ströretur SR2",
    });
  });

  it("R-202 när bufferten är för kort", () => {
    const config = defaultConfig();
    config.flow.finalConveyorLengthMm = 4000;
    const diag = computeLayout(config).diagnostics.find((d) => d.code === "R-202");
    expect(diag).toBeDefined();
    expect(diag!.fix).toMatchObject({ kind: "flow" });
  });

  it("R-302 när paketet är för långt för maskinerna", () => {
    const config = defaultConfig();
    config.product.packageLengthMm = 7200;
    expect(codes(config)).toContain("R-302");
  });

  it("R-303 när paketet är för tungt", () => {
    const config = defaultConfig();
    config.product.packageWeightKg = 5000;
    expect(codes(config)).toContain("R-303");
  });

  it("R-301 när målkapaciteten inte nås", () => {
    const config = defaultConfig();
    config.product.targetPackagesPerHour = 40;
    expect(codes(config)).toContain("R-301");
  });

  it("R-103 när en manuell förskjutning skapar överlapp", () => {
    const config = defaultConfig();
    config.line[2].manualOffset = { x: -4000, y: 0 };
    expect(codes(config)).toContain("R-103");
  });

  it("R-203 när pulpeten hamnar i truckgatan", () => {
    const config = defaultConfig();
    config.flow.truckPickupSide = config.flow.controlDeskSide;
    const diag = computeLayout(config).diagnostics.find((d) => d.code === "R-203");
    expect(diag).toBeDefined();
    expect(diag!.fix).toMatchObject({ kind: "flow" });
  });

  it("åtgärdsförslag går att applicera och tar bort felet", () => {
    const config = defaultConfig();
    config.flow.finalConveyorLengthMm = 4000;
    const diag = computeLayout(config).diagnostics.find((d) => d.code === "R-202")!;
    if (diag.fix?.kind !== "flow") throw new Error("förväntade ett flödesförslag");
    const fixed = { ...config, flow: { ...config.flow, ...diag.fix.patch } };
    expect(codes(fixed)).not.toContain("R-202");
  });

  it("diagnostik dubbletteras inte", () => {
    const list = computeLayout(defaultConfig()).diagnostics;
    const keys = list.map((d) => `${d.code}|${[...d.instanceIds].sort().join(",")}|${d.title}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("fel sorteras före varningar", () => {
    const config = defaultConfig();
    config.hall.lengthMm = 15000;
    config.product.targetPackagesPerHour = 40;
    const severities = computeLayout(config).diagnostics.map((d) => d.severity);
    const firstWarning = severities.indexOf("warning");
    if (firstWarning >= 0) expect(severities.slice(firstWarning)).not.toContain("error");
  });

  it("alla mallar är giltiga", () => {
    for (const id of ["strolinje", "paketlinje", "komplett", "vinklad"]) {
      const layout = computeLayout(templateConfig(id));
      const errors = layout.diagnostics.filter((d) => d.severity === "error");
      expect(errors, `${id}: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0);
    }
  });
});

describe("hjälpobjekt", () => {
  it("placeras utan att krocka med varandra på samma sida", () => {
    const config = defaultConfig();
    config.flow.controlDeskSide = "right";
    config.flow.stickerMagazineSide = "right";
    const layout = computeLayout(config);
    const overlaps = layout.diagnostics.filter(
      (d) => d.code === "R-103" && d.instanceIds.length === 2,
    );
    expect(overlaps).toHaveLength(0);
  });
});
