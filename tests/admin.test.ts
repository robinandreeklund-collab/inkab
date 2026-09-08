import { describe, expect, it } from "vitest";
import { libraryDocumentSchema, machineSchema } from "@/lib/machineSchema";
import { BUILTIN_MACHINES, makeLibrary } from "@/lib/library";
import { computeLayout } from "@/lib/layout";
import { defaultConfig, lineItem } from "@/lib/templates";
import type { Machine } from "@/lib/types";

const conveyor = (): Machine => ({
  id: "test-kt",
  sku: "TEST-KT",
  name: "Testtransportör",
  category: "transport",
  summary: "",
  footprint: { lengthMm: 6000, widthMm: 2400, heightMm: 900 },
  ports: [
    {
      id: "in",
      role: "in",
      pos: { x: 0, y: 1200 },
      dir: "x+",
      levelMm: 900,
      widthMm: [600, 2400],
      allowsDirectionChange: false,
    },
    {
      id: "out",
      role: "out",
      pos: { x: 6000, y: 1200 },
      dir: "x+",
      levelMm: 900,
      widthMm: [600, 2400],
      allowsDirectionChange: false,
    },
  ],
  mirrorable: false,
  zones: [],
  capacity: {
    packagesPerHour: 30,
    packageLengthMm: [2400, 6000],
    packageWidthMm: [800, 1300],
    packageHeightMm: [500, 1400],
    maxWeightKg: 3000,
  },
  utilities: { powerKw: 4, airNlPerMin: 0 },
  foundation: { pitDepthMm: 0, pointLoadKn: 20 },
  leadTimeWeeks: 12,
  options: [],
});

describe("maskinschemat", () => {
  it("godkänner en korrekt maskin", () => {
    expect(machineSchema.safeParse(conveyor()).success).toBe(true);
  });

  it("godkänner hela det inbyggda biblioteket", () => {
    for (const machine of BUILTIN_MACHINES) {
      const result = machineSchema.safeParse(machine);
      expect(result.success, `${machine.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it("kräver både in- och utport på en maskin i kedjan", () => {
    const machine = conveyor();
    machine.ports = machine.ports.filter((p) => p.role === "in");
    const result = machineSchema.safeParse(machine);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("inport och en utport");
  });

  it("avvisar portar utanför fotavtrycket", () => {
    const machine = conveyor();
    machine.ports[1].pos.x = 99000;
    const result = machineSchema.safeParse(machine);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("0 och 6000 mm");
  });

  it("avvisar dubblerade port-id", () => {
    const machine = conveyor();
    machine.ports[1].id = "in";
    expect(machineSchema.safeParse(machine).success).toBe(false);
  });

  it("avvisar portar på hjälpobjekt", () => {
    const machine = { ...conveyor(), aux: true };
    const result = machineSchema.safeParse(machine);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Hjälpobjekt");
  });

  it("avvisar ogiltiga id", () => {
    for (const id of ["Stor Bokstav", "å-ä-ö", "x", "med mellanslag"]) {
      expect(machineSchema.safeParse({ ...conveyor(), id }).success, id).toBe(false);
    }
  });

  it("avvisar minlängd över maxlängd", () => {
    const machine = conveyor();
    machine.parametricLength = { minMm: 20000, maxMm: 3000, pricePerMeter: 1000 };
    expect(machineSchema.safeParse(machine).success).toBe(false);
  });
});

describe("biblioteksdokumentet", () => {
  const priceBook = {
    id: "test",
    name: "Testprisbok",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    currency: "SEK" as const,
    entries: {},
    installFactor: {},
    controlFactor: 0.09,
    freight: 0,
    indicationSpread: { low: 0.9, high: 1.1 },
  };

  it("avvisar dubblerade maskin-id", () => {
    const result = libraryDocumentSchema.safeParse({
      machines: [conveyor(), conveyor()],
      priceBook,
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Dubblerade maskin-id");
  });

  it("avvisar beroenden som inte finns i biblioteket", () => {
    const machine = { ...conveyor(), requires: ["finns-inte"] };
    const result = libraryDocumentSchema.safeParse({ machines: [machine], priceBook });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("finns-inte");
  });

  it("godkänner beroenden inom biblioteket", () => {
    const a = conveyor();
    const b = { ...conveyor(), id: "test-kt-2", sku: "T2", requires: ["test-kt"] };
    expect(libraryDocumentSchema.safeParse({ machines: [a, b], priceBook }).success).toBe(true);
  });
});

describe("admin-redigerad data driver motorn", () => {
  it("en ny maskin går att koppla in i en kedja", () => {
    const library = makeLibrary([...BUILTIN_MACHINES, conveyor()]);
    const config = defaultConfig();
    config.line.splice(1, 0, lineItem("test-kt"));

    const layout = computeLayout(config, library);
    const placed = layout.placements.find((p) => p.machineId === "test-kt");
    expect(placed).toBeDefined();
    expect(placed!.size.lengthMm).toBe(6000);

    const errors = layout.diagnostics.filter((d) => d.severity === "error");
    expect(errors, JSON.stringify(errors)).toHaveLength(0);
  });

  it("ändrade mått slår igenom i layouten", () => {
    const long = conveyor();
    long.footprint.lengthMm = 14000;
    long.ports[1].pos.x = 14000;

    const config = defaultConfig();
    config.line.splice(1, 0, lineItem("test-kt"));

    const short = computeLayout(config, makeLibrary([...BUILTIN_MACHINES, conveyor()]));
    const longer = computeLayout(config, makeLibrary([...BUILTIN_MACHINES, long]));

    expect(longer.metrics.totalLengthMm - short.metrics.totalLengthMm).toBe(8000);
  });

  it("en maskin som tas bort ur biblioteket ignoreras i stället för att krascha", () => {
    const library = makeLibrary(BUILTIN_MACHINES.filter((m) => m.id !== "bandomforing"));
    const config = defaultConfig();
    expect(() => computeLayout(config, library)).not.toThrow();
    const layout = computeLayout(config, library);
    expect(layout.placements.some((p) => p.machineId === "bandomforing")).toBe(false);
  });
});
