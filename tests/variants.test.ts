import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { BUILTIN_MACHINES, makeLibrary } from "@/lib/library";
import { machineSchema } from "@/lib/machineSchema";
import { priceConfiguration } from "@/lib/server/pricing";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { resolveVariant } from "@/lib/solver";
import { applyModelFootprint } from "@/lib/cad/applyModel";
import { templateConfig } from "@/lib/templates";
import type { Configuration, Machine } from "@/lib/types";

/**
 * Utföranden: samma maskin i olika längder.
 *
 * Poängen med att lösa upp dem i effectiveMachine är att inget nedströms ska
 * behöva känna till dem — solvern, reglerna och prissättningen ska bara se en
 * maskin med sina mått. Testerna kontrollerar just det.
 */

/*
 * Basmaskinen är avsiktligt en icke-parametrisk: rullbanan har steglös längd,
 * och den regeln testas för sig längre ner.
 */
const base = BUILTIN_MACHINES.find((m) => m.id === "rullbana-underslag")!;

const withVariants: Machine = {
  ...base,
  variants: [
    { id: "3m", name: "3 m", footprint: { lengthMm: 3000, widthMm: 1570, heightMm: 600 } },
    { id: "6m", name: "6 m", footprint: { lengthMm: 6000, widthMm: 1570, heightMm: 600 } },
    {
      id: "12m",
      name: "12 m",
      footprint: { lengthMm: 12_000, widthMm: 1570, heightMm: 600 },
      packagesPerHour: 30,
      model: { glb: "/api/models/rullbana-12m", upAxis: "y", yawDeg: 270 },
    },
  ],
};

describe("resolveVariant", () => {
  it("tar det första utförandet när inget är valt", () => {
    expect(resolveVariant(withVariants).footprint.lengthMm).toBe(3000);
  });

  it("tar det valda utförandet", () => {
    expect(resolveVariant(withVariants, "12m").footprint.lengthMm).toBe(12_000);
  });

  it("faller tillbaka på det första vid okänt id", () => {
    // Ett borttaget utförande i en sparad konfiguration ska inte spränga
    // layouten — den ritas med förvalet i stället.
    expect(resolveVariant(withVariants, "finns-inte").footprint.lengthMm).toBe(3000);
  });

  it("låter en maskin utan utföranden vara orörd", () => {
    expect(resolveVariant(base)).toBe(base);
  });

  it("tar med utförandets modell och kapacitet", () => {
    const resolved = resolveVariant(withVariants, "12m");
    expect(resolved.model?.glb).toBe("/api/models/rullbana-12m");
    expect(resolved.capacity.packagesPerHour).toBe(30);
  });

  it("behåller maskinens övriga data", () => {
    const resolved = resolveVariant(withVariants, "6m");
    expect(resolved.options).toBe(base.options);
    expect(resolved.aiDescription).toBe(base.aiDescription);
  });
});

describe("utföranden i layouten", () => {
  const library = makeLibrary(
    BUILTIN_MACHINES.map((m) => (m.id === base.id ? withVariants : m)),
  );

  const configWith = (variantId?: string): Configuration => {
    const config = templateConfig("strolinje");
    return {
      ...config,
      line: [{ instanceId: "i1", machineId: base.id, variantId, selectedOptions: [] }],
    };
  };

  it("ritar maskinen med utförandets längd", () => {
    const short = computeLayout(configWith("3m"), library);
    const long = computeLayout(configWith("12m"), library);
    expect(short.placements[0].size.lengthMm).toBe(3000);
    expect(long.placements[0].size.lengthMm).toBe(12_000);
    expect(long.bounds.l).toBeGreaterThan(short.bounds.l);
  });

  it("skalar portarna med utförandet", () => {
    // Utförandet har inga egna portar, så basmaskinens skalas — utporten ska
    // hamna i änden på det verkliga måttet, inte på grundmåttet.
    const placement = computeLayout(configWith("12m"), library).placements[0];
    const inPort = placement.ports.find((p) => p.role === "in")!;
    const outPort = placement.ports.find((p) => p.role === "out")!;
    const span = Math.hypot(outPort.pos.x - inPort.pos.x, outPort.pos.y - inPort.pos.y);
    expect(Math.round(span)).toBe(12_000);
  });

  it("räknar kapaciteten ur utförandet", () => {
    expect(computeLayout(configWith("12m"), library).metrics.throughputPerHour).toBe(30);
  });
});

describe("utföranden i priset", () => {
  const library = makeLibrary(
    BUILTIN_MACHINES.map((m) => (m.id === base.id ? withVariants : m)),
  );
  const priceBook = {
    ...BUILTIN_PRICE_BOOK,
    entries: {
      ...BUILTIN_PRICE_BOOK.entries,
      [base.id]: {
        ...BUILTIN_PRICE_BOOK.entries[base.id],
        variants: {
          "3m": { list: 74_000, cost: 47_000 },
          "12m": { list: 210_000, cost: 132_000 },
        },
      },
    },
  };
  const configWith = (variantId: string): Configuration => ({
    ...templateConfig("strolinje"),
    line: [{ instanceId: "i1", machineId: base.id, variantId, selectedOptions: [] }],
  });

  it("använder utförandets pris", () => {
    const short = priceConfiguration(configWith("3m"), "admin", library, priceBook);
    const long = priceConfiguration(configWith("12m"), "admin", library, priceBook);
    expect(short.lines[0].listPrice).toBe(74_000);
    expect(long.lines[0].listPrice).toBe(210_000);
  });

  it("faller tillbaka på grundpriset när utförandet saknar pris", () => {
    // Ett nytt utförande ska fungera innan prissättningen är gjord.
    const mid = priceConfiguration(configWith("6m"), "admin", library, priceBook);
    expect(mid.lines[0].listPrice).toBe(BUILTIN_PRICE_BOOK.entries[base.id].list);
  });

  it("skriver utförandet i benämningen på offertraden", () => {
    const long = priceConfiguration(configWith("12m"), "admin", library, priceBook);
    expect(long.lines[0].name).toBe(`${base.name} – 12 m`);
  });
});

describe("schemat", () => {
  it("godkänner utföranden", () => {
    const parsed = machineSchema.safeParse(withVariants);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("underkänner dubblerade id", () => {
    const parsed = machineSchema.safeParse({
      ...withVariants,
      variants: [withVariants.variants![0], withVariants.variants![0]],
    });
    expect(parsed.success).toBe(false);
  });

  it("underkänner en port utanför utförandets fotavtryck", () => {
    const parsed = machineSchema.safeParse({
      ...withVariants,
      variants: [
        {
          ...withVariants.variants![0],
          ports: [{ ...base.ports[1], pos: { x: 9000, y: 500 } }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("utföranden och steglös längd", () => {
  /*
   * Rullbanan har steglös längd. Läggs utföranden på en sådan maskin måste
   * en av dem vinna, annars beror maskinens mått på var i kedjan den råkar
   * sitta. Utförandet vinner: det är den längd som finns att köpa.
   */
  const parametric = BUILTIN_MACHINES.find((m) => m.id === "rullbana")!;
  const withBoth: Machine = {
    ...parametric,
    variants: [
      { id: "3m", name: "3 m", footprint: { ...parametric.footprint, lengthMm: 3000 } },
      { id: "12m", name: "12 m", footprint: { ...parametric.footprint, lengthMm: 12_000 } },
    ],
  };
  const library = makeLibrary(
    BUILTIN_MACHINES.map((m) => (m.id === "rullbana" ? withBoth : m)),
  );

  it("låter utförandet bestämma längden", () => {
    const template = templateConfig("strolinje");
    const config: Configuration = {
      ...template,
      // Hallens längdstyrning säger 12 m; utförandet säger 3 m.
      flow: { ...template.flow, finalConveyorLengthMm: 12_000 },
      line: [{ instanceId: "i1", machineId: "rullbana", variantId: "3m", selectedOptions: [] }],
    };
    expect(computeLayout(config, library).placements[0].size.lengthMm).toBe(3000);
  });

  it("lämnar steglös längd orörd för maskiner utan utföranden", () => {
    const template = templateConfig("strolinje");
    const config: Configuration = {
      ...template,
      flow: { ...template.flow, finalConveyorLengthMm: 9000 },
      line: [{ instanceId: "i1", machineId: "rullbana", selectedOptions: [] }],
    };
    const plain = makeLibrary(BUILTIN_MACHINES);
    expect(computeLayout(config, plain).placements[0].size.lengthMm).toBe(9000);
  });
});

describe("zoner följer måtten", () => {
  const machine = BUILTIN_MACHINES.find((m) => m.id === "tsl-enkel")!;

  it("behåller skyddszonens marginaler när maskinen krymper", () => {
    /*
     * Skyddszonen ligger 700 mm utanför maskinen i båda ändar. Krymper
     * maskinen ska marginalen vara kvar — ett skyddsavstånd är ett fysiskt
     * mått, inte en andel. Proportionell skalning hade gjort den 500 mm.
     */
    const safety = machine.zones.find((z) => z.type === "safety")!;
    const marginBefore = -safety.box.x;
    const half = { ...machine.footprint, lengthMm: Math.round(machine.footprint.lengthMm / 2) };

    const { machine: applied } = applyModelFootprint(machine, half);
    const after = applied.zones.find((z) => z.type === "safety")!;

    expect(-after.box.x).toBe(marginBefore);
    expect(after.box.x + after.box.l - half.lengthMm).toBe(marginBefore);
  });

  it("låter servicezonen följa maskinens längd", () => {
    // Servicezonen går längs hela maskinen. Den ska sluta där maskinen slutar.
    const longer = { ...machine.footprint, lengthMm: machine.footprint.lengthMm * 2 };
    const { machine: applied, scaledZones } = applyModelFootprint(machine, longer);
    const service = applied.zones.find((z) => z.type === "service")!;

    expect(service.box.l).toBe(longer.lengthMm);
    expect(scaledZones).toBeGreaterThan(0);
  });

  it("räknar om zonerna för ett utförande", () => {
    const twelve: Machine = {
      ...machine,
      variants: [
        {
          id: "12m",
          name: "12 m",
          footprint: { ...machine.footprint, lengthMm: 12_000 },
        },
      ],
    };
    const resolved = resolveVariant(twelve, "12m");
    const service = resolved.zones.find((z) => z.type === "service")!;
    expect(service.box.l).toBe(12_000);
  });

  it("rör inga zoner när måttet är oförändrat", () => {
    const { machine: applied, scaledZones } = applyModelFootprint(machine, machine.footprint);
    expect(scaledZones).toBe(0);
    expect(applied.zones).toEqual(machine.zones);
  });
});

describe("uppmätt modell slår steglös längd", () => {
  /*
   * Rullbanan har steglös längd, och den sista i kedjan styrs av flödesfrågan
   * (12 m som standard). Med en uppmätt CAD-modell på 3 m är det fel: den
   * maskinen har den längd modellen visar. Symptomet var att varje ny rullbana
   * blev enorm medan den föregående blev korrekt, eftersom rollen som "sista
   * transportör" hoppade till den senast tillagda.
   */
  const parametric = BUILTIN_MACHINES.find((m) => m.id === "rullbana")!;
  const measured: Machine = {
    ...parametric,
    footprint: { lengthMm: 3000, widthMm: 1570, heightMm: 600 },
    model: { glb: "/api/models/rullbana", upAxis: "y", yawDeg: 270 },
  };

  const lineOf = (n: number): Configuration => {
    const template = templateConfig("strolinje");
    return {
      ...template,
      flow: { ...template.flow, finalConveyorLengthMm: 12_000 },
      line: Array.from({ length: n }, (_, i) => ({
        instanceId: `i${i}`,
        machineId: "rullbana",
        selectedOptions: [],
      })),
    };
  };

  it("låter modellens längd gälla, oavsett plats i kedjan", () => {
    const library = makeLibrary(
      BUILTIN_MACHINES.map((m) => (m.id === "rullbana" ? measured : m)),
    );
    for (const antal of [1, 2, 3]) {
      const layout = computeLayout(lineOf(antal), library);
      for (const placement of layout.placements) {
        expect(placement.size.lengthMm).toBe(3000);
      }
    }
  });

  it("styr fortfarande en transportör utan modell", () => {
    // Frågan ska inte sluta fungera för maskiner som verkligen kapas.
    const plain = makeLibrary(BUILTIN_MACHINES);
    const layout = computeLayout(lineOf(2), plain);
    expect(layout.placements[1].size.lengthMm).toBe(12_000);
    expect(layout.placements[0].size.lengthMm).toBe(parametric.footprint.lengthMm);
  });

  it("säger till när längdfrågan inte styr något", () => {
    const library = makeLibrary(
      BUILTIN_MACHINES.map((m) => (m.id === "rullbana" ? measured : m)),
    );
    const codes = computeLayout(lineOf(2), library).diagnostics.map((d) => d.code);
    expect(codes).toContain("R-206");
  });
});
