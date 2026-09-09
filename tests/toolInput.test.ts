import { describe, expect, it } from "vitest";
import { camelCase, normaliseToolInput } from "@/lib/ai/toolInput";
import { executeTool, type ToolContext } from "@/lib/ai/tools";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { defaultConfig } from "@/lib/templates";

/**
 * Argument som är nästan rätt.
 *
 * Bara Anthropic håller verktygsschemat åt oss. Det som kommer från andra
 * leverantörer kan ha nycklarna i snake_case, argumenten inslagna i ett extra
 * fält, eller hela objektet skickat som en sträng. Att avvisa det är inte
 * hjälpsamt: modellen skickade ju ett maskin-id, och gör om samma anrop.
 */

function context(): ToolContext {
  const config = defaultConfig();
  return {
    original: JSON.parse(JSON.stringify(config)),
    draft: JSON.parse(JSON.stringify(config)),
    variants: [],
    role: "guest",
    library: BUILTIN_LIBRARY,
    priceBook: BUILTIN_PRICE_BOOK,
  };
}

describe("camelCase", () => {
  it("gör om snake_case till verktygens stavning", () => {
    expect(camelCase("machine_id")).toBe("machineId");
    expect(camelCase("out_port_id")).toBe("outPortId");
    expect(camelCase("from_x_m")).toBe("fromXM");
    expect(camelCase("lengthM")).toBe("lengthM");
  });
});

describe("normaliseToolInput", () => {
  it("släpper igenom det som redan är rätt", () => {
    expect(normaliseToolInput({ machineId: "rullbana" })).toEqual({ machineId: "rullbana" });
  });

  it("rättar snake_case", () => {
    expect(normaliseToolInput({ machine_id: "rullbana", out_port_id: "ut" })).toEqual({
      machineId: "rullbana",
      outPortId: "ut",
    });
  });

  it("packar upp argument som skickats som en sträng", () => {
    expect(normaliseToolInput('{"machineId": "rullbana"}')).toEqual({ machineId: "rullbana" });
  });

  it("packar upp argument inslagna i ett extra fält", () => {
    expect(normaliseToolInput({ arguments: { machine_id: "rullbana" } })).toEqual({
      machineId: "rullbana",
    });
    expect(normaliseToolInput({ input: '{"machineId":"rullbana"}' })).toEqual({
      machineId: "rullbana",
    });
  });

  it("går ner i listor och nästlade objekt", () => {
    expect(
      normaliseToolInput({
        length_m: 15,
        walls: [{ from_x_m: 0, from_y_m: 0, to_x_m: 15, to_y_m: 0 }],
      }),
    ).toEqual({ lengthM: 15, walls: [{ fromXM: 0, fromYM: 0, toXM: 15, toYM: 0 }] });
  });

  it("låter den riktiga stavningen vinna när båda finns", () => {
    const result = normaliseToolInput({ machineId: "rullbana", machine_id: "lattpress" });
    expect(result.machineId).toBe("rullbana");
  });

  it("ger ett tomt objekt av skräp i stället för att kasta", () => {
    expect(normaliseToolInput(null)).toEqual({});
    expect(normaliseToolInput("inte json")).toEqual({});
    expect(normaliseToolInput([1, 2, 3])).toEqual({});
  });
});

describe("verktygen tar emot det normaliserade", () => {
  it("lägger till maskinen fast nyckeln var i snake_case", () => {
    const ctx = context();
    const before = ctx.draft.line.length;
    const result = executeTool("add_machine", { machine_id: "rullbana" } as never, ctx) as {
      error?: string;
    };
    expect(result.error).toBeUndefined();
    expect(ctx.draft.line).toHaveLength(before + 1);
  });

  it("ritar hallen fast måtten hette length_m och width_m", () => {
    const ctx = context();
    executeTool(
      "draw_hall",
      {
        length_m: 15,
        width_m: 9,
        scale_note: "15 m längs överkant",
        walls: [{ from_x_m: 0, from_y_m: 0, to_x_m: 15, to_y_m: 0 }],
      } as never,
      ctx,
    );
    expect(ctx.draft.hall.lengthMm).toBe(15_000);
    expect(ctx.draft.hall.widthMm).toBe(9000);
    expect(ctx.scaleVerified).toBe(true);
  });

  it("säger vad som saknades när maskin-id inte kom med alls", () => {
    const result = executeTool("add_machine", {} as never, context()) as { error?: string };
    // "Okänd maskin: undefined" fick en modell att göra om samma anrop tre
    // gånger. Felet ska säga vad som saknas och hur ett riktigt anrop ser ut.
    expect(result.error).toContain("machineId saknas");
    expect(result.error).toContain("t.ex.");
  });

  it("räknar upp giltiga id när maskinen inte finns", () => {
    const result = executeTool("add_machine", { machineId: "finns-inte" }, context()) as {
      error?: string;
    };
    expect(result.error).toContain("Okänd maskin: finns-inte");
    expect(result.error).toContain(BUILTIN_LIBRARY.machines[0].id);
  });
});
