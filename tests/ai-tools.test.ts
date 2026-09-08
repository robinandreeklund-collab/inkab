import { describe, expect, it } from "vitest";
import { toolDefinitions, executeTool, type ToolContext } from "@/lib/ai/tools";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { defaultConfig } from "@/lib/templates";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import type { Configuration } from "@/lib/types";

/**
 * Med strict: true accepterar Messages API bara en delmängd av JSON Schema.
 * Numeriska och stränglängdsbegränsningar avvisas med 400 vid anropet — alltså
 * först i produktion, med riktig nyckel. Testet fångar det i stället.
 */
const FORBIDDEN = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
];

/** Alla nycklar i ett schema, rekursivt, med sin sökväg. */
function walk(node: unknown, path: string[] = []): { path: string; key: string }[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => walk(item, [...path, String(i)]));
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) => [
      { path: [...path, key].join("."), key },
      ...walk(value, [...path, key]),
    ]);
  }
  return [];
}

function context(config: Configuration): ToolContext {
  return {
    original: JSON.parse(JSON.stringify(config)),
    draft: JSON.parse(JSON.stringify(config)),
    variants: [],
    role: "guest",
    library: BUILTIN_LIBRARY,
    priceBook: BUILTIN_PRICE_BOOK,
  };
}

describe("verktygsscheman", () => {
  const tools = toolDefinitions();

  it("använder inga nyckelord som strict-läget avvisar", () => {
    for (const tool of tools) {
      const found = walk(tool.input_schema)
        .filter((entry) => FORBIDDEN.includes(entry.key))
        .map((entry) => `${tool.name}: ${entry.path}`);
      expect(found, found.join(", ")).toHaveLength(0);
    }
  });

  it("varje objekt har additionalProperties: false och required", () => {
    for (const tool of tools) {
      expect(tool.input_schema.additionalProperties, tool.name).toBe(false);
      expect(Array.isArray(tool.input_schema.required), tool.name).toBe(true);
    }
  });

  it("alla verktyg är strikta och unikt namngivna", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of tools) expect(tool.strict, tool.name).toBe(true);
  });

  it("maskin-enumet följer biblioteket", () => {
    const addMachine = tools.find((t) => t.name === "add_machine")!;
    const machineId = addMachine.input_schema.properties.machineId as { enum: string[] };
    expect(machineId.enum).toEqual(BUILTIN_LIBRARY.machines.map((m) => m.id));
  });
});

describe("serverklippning ersätter schemats intervall", () => {
  it("klipper sista transportörens längd", () => {
    const ctx = context(defaultConfig());
    executeTool("set_flow", { finalConveyorLengthMm: 999_999 }, ctx);
    expect(ctx.draft.flow.finalConveyorLengthMm).toBe(40_000);

    executeTool("set_flow", { finalConveyorLengthMm: 10 }, ctx);
    expect(ctx.draft.flow.finalConveyorLengthMm).toBe(1000);
  });

  it("klipper hallens mått", () => {
    const ctx = context(defaultConfig());
    executeTool("set_hall", { lengthMm: 9_000_000, widthMm: 1, clearHeightMm: 99_000 }, ctx);
    expect(ctx.draft.hall.lengthMm).toBe(300_000);
    expect(ctx.draft.hall.widthMm).toBe(5000);
    expect(ctx.draft.hall.clearHeightMm).toBe(30_000);
  });

  it("klipper insättningspositionen i stället för att kasta", () => {
    const config = defaultConfig();
    const ctx = context(config);
    const before = ctx.draft.line.length;
    executeTool("add_machine", { machineId: "rullbana", atIndex: 9999 }, ctx);
    expect(ctx.draft.line).toHaveLength(before + 1);
    expect(ctx.draft.line[before].machineId).toBe("rullbana");

    executeTool("add_machine", { machineId: "rullbana", atIndex: -5 }, ctx);
    expect(ctx.draft.line[0].machineId).toBe("rullbana");
  });

  it("avvisar okänd maskin med ett fel modellen kan läsa", () => {
    const ctx = context(defaultConfig());
    const result = executeTool("add_machine", { machineId: "finns-inte" }, ctx) as {
      error?: string;
    };
    expect(result.error).toContain("Okänd maskin");
  });
});
