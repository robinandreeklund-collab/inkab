import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { defaultConfig } from "@/lib/templates";
import { configurationSchema } from "@/lib/schema";
import {
  blocksMachines,
  isAisle,
  migrateDrawn,
  zoneDef,
  ZONES,
} from "@/lib/zones";
import { nextName } from "@/lib/drawing";
import { translate } from "@/lib/i18n/translate";
import type { DrawnObject } from "@/lib/types";

const codes = (c: Parameters<typeof computeLayout>[0]) =>
  computeLayout(c).diagnostics.map((d) => d.code);

/** Lägger en zon över en maskin i standardlinjen och svarar vad reglerna säger. */
function over(zone: string): string[] {
  const config = defaultConfig();
  const target = computeLayout(config).placements[1].bbox;
  config.drawn.push({
    id: "z",
    kind: "zone",
    zone: zoneDef(zone).id,
    name: "Yta",
    x: target.x + 200,
    y: target.y + 200,
    l: 1200,
    w: 1200,
    h: 0,
  });
  return codes(config);
}

describe("zonkatalogen", () => {
  it("varje sort har namn och beskrivning i ordlistan", async () => {
    const { MESSAGES } = await import("@/lib/i18n/messages");
    for (const zone of ZONES) {
      for (const locale of ["sv", "en", "de"] as const) {
        expect(
          MESSAGES[locale][zone.labelKey],
          `${locale} ${zone.labelKey}`,
        ).toBeTruthy();
        expect(
          MESSAGES[locale][zone.hintKey],
          `${locale} ${zone.hintKey}`,
        ).toBeTruthy();
      }
    }
  });

  it("truckzonen är den enda sorten trucken kör i", () => {
    const aisles = ZONES.filter((z) => z.aisle).map((z) => z.id);
    expect(aisles).toEqual(["truck"]);
  });

  it("okänd sort faller tillbaka på en egen zon, inte på en spärrad yta", () => {
    expect(zoneDef("hittepå").id).toBe("other");
    expect(zoneDef(undefined).blocking).toBe(false);
  });
});

describe("zonerna i reglerna", () => {
  it("en spärrad yta över en maskin ger R-403", () => {
    expect(over("nogo")).toContain("R-403");
  });

  it("en lageryta över en maskin ger R-403", () => {
    expect(over("storage")).toContain("R-403");
  });

  it("ett fundament under en maskin ger inget fel — maskinen ska stå där", () => {
    expect(over("foundation")).not.toContain("R-403");
  });

  it("en egen zon varnar aldrig", () => {
    const diagnostics = over("other");
    expect(diagnostics).not.toContain("R-403");
    expect(diagnostics).not.toContain("R-106");
  });

  it("truckzonen hanteras av R-404, inte av kollisionsregeln", () => {
    const diagnostics = over("truck");
    expect(diagnostics).not.toContain("R-403");
    expect(diagnostics).toContain("R-404");
  });
});

describe("gamla underlag", () => {
  const legacy = {
    id: "t1",
    kind: "truck",
    name: "Hämtzon",
    x: 1000,
    y: 2000,
    l: 9000,
    w: 4000,
    h: 0,
  };

  it("truck och nogo blir zoner med samma betydelse", () => {
    expect(migrateDrawn(legacy)).toEqual({
      ...legacy,
      kind: "zone",
      zone: "truck",
    });
    expect(migrateDrawn({ ...legacy, kind: "nogo" })).toMatchObject({
      kind: "zone",
      zone: "nogo",
    });
  });

  it("en delningslänk med gamla objekt går genom schemat", () => {
    const config = defaultConfig();
    const parsed = configurationSchema.safeParse({
      ...config,
      drawn: [legacy, { ...legacy, id: "n1", kind: "nogo" }],
    });
    expect(parsed.success).toBe(true);
    const drawn = parsed.success ? (parsed.data.drawn as DrawnObject[]) : [];
    expect(drawn.map((d) => d.kind)).toEqual(["zone", "zone"]);
    expect(drawn.filter(isAisle)).toHaveLength(1);
    expect(drawn.filter(blocksMachines)).toHaveLength(1);
  });

  it("en okänd zonsort i ett sparat underlag blir en egen zon", () => {
    expect(
      migrateDrawn({ ...legacy, kind: "zone", zone: "parkering" }),
    ).toMatchObject({
      zone: "other",
    });
  });
});

describe("namngivning", () => {
  it("räknar per sorts zon, inte per objekt", () => {
    const existing: DrawnObject[] = [
      {
        id: "a",
        kind: "zone",
        zone: "truck",
        name: "Truckzon 1",
        x: 0,
        y: 0,
        l: 1,
        w: 1,
        h: 0,
      },
      {
        id: "b",
        kind: "zone",
        zone: "truck",
        name: "Truckzon 2",
        x: 0,
        y: 0,
        l: 1,
        w: 1,
        h: 0,
      },
    ];
    expect(nextName("zone", existing, undefined, "truck")).toBe("Truckzon 3");
    expect(nextName("zone", existing, undefined, "storage")).toBe("Lageryta 1");
  });

  it("tar namnet ur ordlistan när gränssnittet skickar med den", () => {
    const en = (key: string) => translate("en", key);
    expect(nextName("zone", [], en, "storage")).toBe("Storage area 1");
  });
});
