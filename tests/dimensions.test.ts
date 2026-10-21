import { describe, expect, it } from "vitest";
import { dimensionLength, makeDimension, MAX_DIMENSIONS, straighten } from "@/lib/dimensions";
import { configurationSchema } from "@/lib/schema";
import { emptyConfig } from "@/lib/templates";
import { describeChange } from "@/lib/projectLog";

/**
 * Sparade mått: en måttlinje som ligger kvar på ritningen efter att man mätt.
 */
describe("sparade mått", () => {
  it("avrundas till centimeter och mäter rätt", () => {
    const d = makeDimension({ x: 1003, y: 2004 }, { x: 4006, y: 2004 })!;
    expect(d.from).toEqual({ x: 1000, y: 2000 });
    expect(d.to).toEqual({ x: 4010, y: 2000 });
    expect(dimensionLength(d)).toBe(3010);
  });

  it("ett klick är inget mått", () => {
    expect(makeDimension({ x: 0, y: 0 }, { x: 40, y: 30 })).toBeNull();
  });

  it("låses till vågrätt eller lodrätt åt det håll det lutar mest", () => {
    expect(straighten({ x: 0, y: 0 }, { x: 5000, y: 400 })).toEqual({ x: 5000, y: 0 });
    expect(straighten({ x: 0, y: 0 }, { x: 300, y: -4000 })).toEqual({ x: 0, y: -4000 });
  });

  it("går igenom serverns validering och följer med konfigurationen", () => {
    const config = emptyConfig();
    const d = makeDimension({ x: 0, y: 0 }, { x: 6000, y: 0 })!;
    config.dimensions = [{ ...d, note: "Fritt mellan pelarna" }];
    const parsed = configurationSchema.parse(config);
    expect(parsed.dimensions?.[0].note).toBe("Fritt mellan pelarna");
  });

  it("har ett tak", () => {
    const config = emptyConfig();
    config.dimensions = Array.from({ length: MAX_DIMENSIONS + 1 }, (_, i) => ({
      id: `d${i}`,
      from: { x: 0, y: 0 },
      to: { x: 1000, y: 0 },
    }));
    expect(configurationSchema.safeParse(config).success).toBe(false);
  });

  it("skriver en rad i projektloggen", () => {
    const before = emptyConfig();
    const after = emptyConfig();
    after.dimensions = [makeDimension({ x: 0, y: 0 }, { x: 6000, y: 0 })!];
    expect(describeChange(before, after, (id) => id)?.text).toMatch(/mått/i);
  });
});

describe("sparade mått i DXF-filen", () => {
  it("ritas på lagret MATT med längden utskriven", async () => {
    const { planDxf } = await import("@/lib/export");
    const { computeLayout } = await import("@/lib/layout");
    const config = emptyConfig();
    config.dimensions = [{ ...makeDimension({ x: 0, y: 0 }, { x: 6000, y: 0 })!, note: "Fritt" }];
    const dxf = planDxf(config, computeLayout(config));
    expect(dxf).toContain("MATT");
    expect(dxf).toContain("6.00 m Fritt");
  });
});
