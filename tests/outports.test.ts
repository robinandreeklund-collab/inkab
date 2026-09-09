import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { BUILTIN_MACHINES, makeLibrary } from "@/lib/library";
import { machineSchema } from "@/lib/machineSchema";
import { configurationSchema } from "@/lib/schema";
import { pickOutPort } from "@/lib/solver";
import { templateConfig } from "@/lib/templates";
import type { Configuration, Machine } from "@/lib/types";

/**
 * Flera utgångar per maskin.
 *
 * En rullbana kan lämna paketet rakt fram eller ut på kortsidan. Vilken som
 * används är ett val i linjen, inte en egenskap hos maskinen: samma rullbana
 * kan gå rakt i ett flöde och vinkla i ett annat.
 */

const base = BUILTIN_MACHINES.find((m) => m.id === "rullbana-underslag")!;

const twoWay: Machine = {
  ...base,
  model: { glb: "/x" },
  footprint: { lengthMm: 6000, widthMm: 2000, heightMm: 800 },
  ports: [
    { ...base.ports[0], id: "in", role: "in", pos: { x: 0, y: 1000 }, dir: "x+" },
    {
      ...base.ports[1],
      id: "ut",
      name: "Rakt fram",
      role: "out",
      pos: { x: 6000, y: 1000 },
      dir: "x+",
    },
    {
      ...base.ports[1],
      id: "ut-sida",
      name: "Ut på kortsidan",
      role: "out",
      pos: { x: 3000, y: 2000 },
      dir: "y+",
      allowsDirectionChange: true,
    },
  ],
};

const library = makeLibrary(BUILTIN_MACHINES.map((m) => (m.id === base.id ? twoWay : m)));

const lineWith = (outPortId?: string): Configuration => {
  const template = templateConfig("strolinje");
  return {
    ...template,
    line: [
      { instanceId: "a", machineId: base.id, outPortId, selectedOptions: [] },
      { instanceId: "b", machineId: base.id, selectedOptions: [] },
    ],
  };
};

describe("pickOutPort", () => {
  it("tar den första utgången när inget är valt", () => {
    expect(pickOutPort(twoWay.ports)?.id).toBe("ut");
  });

  it("tar den valda", () => {
    expect(pickOutPort(twoWay.ports, "ut-sida")?.id).toBe("ut-sida");
  });

  it("faller tillbaka på den första vid okänt id", () => {
    // En utgång som tagits bort ur biblioteket ska inte spränga layouten.
    expect(pickOutPort(twoWay.ports, "finns-inte")?.id).toBe("ut");
  });

  it("bryr sig inte om inportar", () => {
    expect(pickOutPort(twoWay.ports, "in")?.id).toBe("ut");
  });
});

describe("utgången styr var nästa maskin hamnar", () => {
  it("fortsätter rakt fram med förvalet", () => {
    const layout = computeLayout(lineWith(), library);
    const [first, second] = layout.placements;
    expect(second.bbox.x).toBeGreaterThan(first.bbox.x);
    expect(Math.round(second.bbox.y)).toBe(Math.round(first.bbox.y));
  });

  it("vinklar flödet när utgången på kortsidan väljs", () => {
    const layout = computeLayout(lineWith("ut-sida"), library);
    const [first, second] = layout.placements;
    // Nästa maskin ska ligga vid sidan om, inte i förlängningen.
    expect(second.bbox.y).toBeGreaterThan(first.bbox.y);
    expect(second.rotation % 180).not.toBe(first.rotation % 180);
  });

  it("byter inte layout av att en annan maskin läggs till", () => {
    const one = computeLayout(lineWith("ut-sida"), library).placements[0];
    const config = lineWith("ut-sida");
    config.line.push({ instanceId: "c", machineId: base.id, selectedOptions: [] });
    const again = computeLayout(config, library).placements[0];
    expect(again.bbox).toEqual(one.bbox);
  });
});

describe("scheman", () => {
  it("godkänner flera utgångar med namn", () => {
    const parsed = machineSchema.safeParse(twoWay);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("underkänner två utgångar med samma id", () => {
    const parsed = machineSchema.safeParse({
      ...twoWay,
      ports: [twoWay.ports[0], twoWay.ports[1], { ...twoWay.ports[2], id: "ut" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("släpper igenom valet i konfigurationen", () => {
    const parsed = configurationSchema.safeParse(lineWith("ut-sida"));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
