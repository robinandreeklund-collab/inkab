import { describe, expect, it } from "vitest";
import { buildSystem } from "@/lib/ai/prompt";
import { executeTool, layoutSummary, toolDefinitions, type ToolContext } from "@/lib/ai/tools";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { markCacheBreakpoint } from "@/lib/server/aiRun";
import { emptyConfig } from "@/lib/templates";

/**
 * Vad en tur med assistenten kostar.
 *
 * En verktygstur skickar om hela samtalet i varje runda. Tio rundor är alltså
 * inte tio gånger den första rundan utan summan av en växande hög: det som
 * läggs till i runda två betalas också i runda tre, fyra och fem. Ett
 * verktygssvar som är en kilotoken för stort kostar därför en kilotoken gånger
 * antalet återstående rundor.
 *
 * Det gör storleken på svaren till något som måste vaktas, inte uppskattas.
 * Testet räknar dem, och räknar en typisk körning från början till slut, så
 * att en oskyldig utökning av ett verktygssvar inte tyst blir dyr.
 *
 * Siffrorna är uppskattade ur teckenlängd (~3,6 tecken per token på svenska).
 * De är till för att jämföra före och efter, inte för att stämma mot fakturan.
 */

const tok = (value: unknown) =>
  Math.round((typeof value === "string" ? value : JSON.stringify(value)).length / 3.6);

/** En scannad A4 som bild, ungefär. */
const PDF_PAGE_TOKENS = 2300;
/** Tankeblock per runda med adaptivt tänkande. */
const THINKING_TOKENS = 1200;

function context(): ToolContext {
  const config = emptyConfig();
  return {
    original: JSON.parse(JSON.stringify(config)),
    draft: JSON.parse(JSON.stringify(config)),
    variants: [],
    role: "guest",
    library: BUILTIN_LIBRARY,
    priceBook: BUILTIN_PRICE_BOOK,
  };
}

const DRAW_HALL = {
  lengthM: 15,
  widthM: 10,
  scaleSource: "dimension_on_drawing",
  scaleNote: "Måttet 15 m står på skissen.",
  replaceExisting: true,
  walls: [
    { fromXM: 0, fromYM: 0, toXM: 15, toYM: 0 },
    { fromXM: 15, fromYM: 0, toXM: 15, toYM: 10 },
    { fromXM: 15, fromYM: 10, toXM: 0, toYM: 10 },
    { fromXM: 0, fromYM: 10, toXM: 0, toYM: 0 },
  ],
  doors: [{ xM: 5, yM: 0, widthM: 3 }],
  areas: [{ kind: "truck", xM: 12, yM: 10, lengthM: 3, widthM: 4 }],
};

describe("storleken på det som skickas", () => {
  it("systemprompt och verktygsdefinitioner ryms i en cachad prefix", () => {
    const system = tok(buildSystem(BUILTIN_LIBRARY).map((b) => b.text).join(""));
    const tools = tok(toolDefinitions(BUILTIN_LIBRARY));
    // Det fasta ligger före cache-brytpunkten och betalas en gång per tur.
    expect(system + tools).toBeLessThan(12_000);
  });

  it("skrivverktygens svar är korta", () => {
    const ctx = context();
    executeTool("draw_hall", DRAW_HALL, ctx);
    for (const id of ["rullbana", "tsl-enkel", "lattpress", "bandomforing"]) {
      executeTool("add_machine", { machineId: id }, ctx);
    }

    // Svaret följer med i varje efterföljande runda. Håll det litet.
    expect(tok(executeTool("add_machine", { machineId: "rullbana" }, ctx))).toBeLessThan(500);
    expect(tok(executeTool("set_flow", { truckPickupSide: "left" }, ctx))).toBeLessThan(500);
    expect(tok(executeTool("draw_hall", DRAW_HALL, ctx))).toBeLessThan(700);
  });

  it("hela layouten hämtas bara när den efterfrågas", () => {
    const ctx = context();
    for (const id of ["rullbana", "tsl-enkel", "lattpress", "bandomforing"]) {
      executeTool("add_machine", { machineId: id }, ctx);
    }
    const brief = tok(layoutSummary(ctx.draft, BUILTIN_LIBRARY));
    const full = tok(executeTool("get_current_layout", {}, ctx));
    expect(brief).toBeLessThan(400);
    expect(full).toBeGreaterThan(brief);
  });

  it("maskinbiblioteket upprepas inte i sin helhet i ett verktygssvar", () => {
    // Grunddata står i systemprompten, som är cachad. Svaret här är en lista
    // att slå upp id i, inte en kopia av prompten.
    expect(tok(executeTool("get_machine_library", {}, context()))).toBeLessThan(1000);
  });
});

describe("en hel körning: rita lokalen och bygg linjen ur en skiss", () => {
  /** Summerar in-token över alla rundor, och vad som är cacheträffar. */
  function simulate(calls: [string, Record<string, unknown>][]) {
    const ctx = context();
    const fixed =
      tok(buildSystem(BUILTIN_LIBRARY).map((b) => b.text).join("")) +
      tok(toolDefinitions(BUILTIN_LIBRARY));
    const first = tok(JSON.stringify(ctx.draft)) + PDF_PAGE_TOKENS + 400;

    let history = first;
    let total = 0;
    let fresh = 0;
    let added = first;

    for (const [name, input] of calls) {
      total += fixed + history;
      // Med rullande brytpunkt är allt utom det sedan sist tillagda en träff.
      fresh += added;
      added = THINKING_TOKENS + tok(executeTool(name, input, ctx)) + 40;
      history += added;
    }
    total += fixed + history;
    fresh += added;

    // Cacheträffar kostar en tiondel.
    const paid = Math.round(fresh + (total - fresh) * 0.1);
    return { rounds: calls.length + 1, total, fresh, paid };
  }

  it("kostar mindre när verktygen svarar kort och prefixet cachas", () => {
    const sparsamt = simulate([
      ["draw_hall", DRAW_HALL],
      ["add_machine", { machineId: "rullbana" }],
      ["add_machine", { machineId: "tsl-enkel" }],
      ["add_machine", { machineId: "lattpress" }],
      ["add_machine", { machineId: "kedjetransportor" }],
      ["set_flow", { truckPickupSide: "left", infeedFrom: "straight" }],
      ["propose_variant", { name: "Från skissen", description: "Linjen enligt skissen." }],
    ]);

    console.log(
      `sparsam körning: ${sparsamt.rounds} rundor, ${sparsamt.total} in-token, ` +
        `varav ${sparsamt.fresh} nya — motsvarar ${sparsamt.paid} obetalda-cache-token`,
    );

    // Taket är satt med marginal mot dagens siffra. Går det över har något
    // vuxit som skickas om i varje runda.
    expect(sparsamt.total).toBeLessThan(160_000);
    expect(sparsamt.paid).toBeLessThan(45_000);
  });
});

describe("cache-brytpunkter", () => {
  type Block = { type: string; text?: string; cache_control?: unknown };
  type Message = { role: "user" | "assistant"; content: Block[] };

  const message = (role: Message["role"], ...types: string[]): Message => ({
    role,
    content: types.map((type) => ({ type, text: "x" })),
  });

  const marks = (messages: Message[]) =>
    messages.map((m) => m.content.filter((b) => b.cache_control).length);

  it("håller kvar frågans brytpunkt och flyttar den andra till slutet", () => {
    const messages: Message[] = [message("user", "image", "text")];
    messages[0].content[1].cache_control = { type: "ephemeral" };

    messages.push(message("assistant", "thinking", "tool_use"));
    messages.push(message("user", "tool_result"));
    markCacheBreakpoint(messages as never, 0);
    expect(marks(messages)).toEqual([1, 0, 1]);

    messages.push(message("assistant", "thinking", "tool_use"));
    messages.push(message("user", "tool_result", "tool_result"));
    markCacheBreakpoint(messages as never, 0);
    // Den gamla rullande brytpunkten är borta, frågans står kvar.
    expect(marks(messages)).toEqual([1, 0, 0, 0, 1]);
    expect(messages[4].content[1].cache_control).toBeTruthy();
  });

  it("sätter aldrig brytpunkten på ett tankeblock", () => {
    const messages: Message[] = [message("user", "text"), message("assistant", "text", "thinking")];
    markCacheBreakpoint(messages as never, 0);
    expect(messages[1].content[1].cache_control).toBeUndefined();
    expect(messages[1].content[0].cache_control).toBeTruthy();
  });

  it("aldrig fler än tre brytpunkter i meddelandena", () => {
    const messages: Message[] = [message("user", "image", "text")];
    messages[0].content[1].cache_control = { type: "ephemeral" };
    for (let round = 0; round < 10; round++) {
      messages.push(message("assistant", "thinking", "tool_use"));
      messages.push(message("user", "tool_result"));
      markCacheBreakpoint(messages as never, 0);
      const total = marks(messages).reduce((a, b) => a + b, 0);
      // En fast plus en rullande; systemprompten har den tredje.
      expect(total).toBe(2);
    }
  });
});
