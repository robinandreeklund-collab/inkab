import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { runAssistant, type AssistantRun } from "@/lib/server/aiRun";
import { TRAITS } from "@/lib/server/assistant";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { defaultConfig, emptyConfig } from "@/lib/templates";
import { startDraftJob } from "@/lib/server/draftJobs";
import { readDraftJob } from "@/lib/server/store";

/**
 * Vad som händer när svaret kommer i en annan form än vi räknat med.
 *
 * Protokollet är detsamma hos flera leverantörer, men allt i det används inte
 * likadant. En modell strömmar sin text som delta efter delta; en annan lägger
 * hela texten i blocket när det öppnas. Läser verktyget bara det första blir
 * svaret tomt — och ett tomt svar ser ut som att ingenting hände, vilket är det
 * sämsta beskedet av alla.
 *
 * Här körs en riktig körning mot en påhittad server som svarar på det andra
 * sättet.
 */

const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Ett meddelande med ett verktygsanrop. */
function toolUseMessage(name: string, input: Record<string, unknown> = {}): string {
  return (
    sse("message_start", {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "provsvar",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }) +
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_1", name, input: {} },
    }) +
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    }) +
    sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 5 },
    }) +
    sse("message_stop", { type: "message_stop" })
  );
}

/** Ett svar där hela texten ligger i blocket i stället för i deltan. */
function textInBlockMessage(text: string): string {
  return (
    sse("message_start", {
      type: "message_start",
      message: {
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "provsvar",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }) +
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text },
    }) +
    sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 5 },
    }) +
    sse("message_stop", { type: "message_stop" })
  );
}

const ANSWER = "Ritningen saknar mått. Jag behöver hallens längd för att kunna skala den.";

let server: Server;
let baseURL = "";
let calls = 0;
/** "svara": ett anrop och sedan text. "loopa": anrop i all evighet.
 *  "trasigt": samma anrop som alltid misslyckas. */
let mode: "svara" | "loopa" | "trasigt" = "svara";

beforeAll(async () => {
  server = createServer((request, response) => {
    calls += 1;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (mode === "trasigt") {
      // En maskin som inte finns: verktyget svarar med fel, varje gång.
      response.end(toolUseMessage("add_machine", { machineId: "finns-inte" }));
      return;
    }
    const keepCalling = mode === "loopa" || calls === 1;
    response.end(
      keepCalling ? toolUseMessage("get_current_layout") : textInBlockMessage(ANSWER),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseURL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => server.close());

const run = () =>
  runAssistant({
    config: defaultConfig(),
    message: "Rita upp lokalen.",
    role: "guest",
    library: BUILTIN_LIBRARY,
    priceBook: BUILTIN_PRICE_BOOK,
    provider: {
      provider: "grok",
      model: "provsvar",
      apiKey: "prov",
      baseURL,
      traits: TRAITS.grok,
    },
  });

describe("svar som inte strömmas som deltan", () => {
  let result: AssistantRun;
  const seen: string[] = [];

  beforeAll(async () => {
    result = await runAssistant({
      config: defaultConfig(),
      message: "Rita upp lokalen.",
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      provider: {
        provider: "grok",
        model: "provsvar",
        apiKey: "prov",
        baseURL,
        traits: TRAITS.grok,
      },
      onEvent: (event) => {
        if (event.type === "text") seen.push(event.text);
      },
    });
  });

  it("tar texten ur det färdiga meddelandet", () => {
    expect(result.text).toContain("saknar mått");
    expect(result.error).toBeNull();
  });

  it("visar den för den som tittar, fast den aldrig kom som delta", () => {
    expect(seen.join("")).toContain("saknar mått");
  });

  it("skriver upp verktygen som kördes", () => {
    expect(result.steps.map((s) => s.name)).toEqual(["get_current_layout"]);
    expect(result.steps[0].ok).toBe(true);
    expect(result.rounds).toBe(2);
    expect(result.stopReason).toBe("answered");
  });
});

describe("när rundorna tar slut", () => {
  it("säger att taket nåddes i stället för att bara sluta", async () => {
    // Servern svarar med verktygsanrop i all evighet; taket ska hålla emot.
    mode = "loopa";
    const result = await runAssistant({
      config: defaultConfig(),
      message: "Rita upp lokalen.",
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      maxRounds: 3,
      provider: {
        provider: "grok",
        model: "provsvar",
        apiKey: "prov",
        baseURL,
        traits: TRAITS.grok,
      },
    });
    expect(result.rounds).toBe(3);
    expect(result.stopReason).toBe("max_rounds");
    expect(result.steps).toHaveLength(3);
    mode = "svara";
  });
});

it("kör mot den valda leverantörens adress", async () => {
  calls = 0;
  const result = await run();
  expect(result.rounds).toBeGreaterThan(0);
});

describe("ett jobb som inte blev något", () => {
  it("förklarar vad som hände i stället för att bara vara tomt", async () => {
    mode = "loopa";
    const job = await startDraftJob({
      config: defaultConfig(),
      note: "Hallen är 15 m lång.",
      attachments: [{ name: "skiss.png", mediaType: "image/png", data: "AAAA" }],
      userId: null,
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      provider: {
        provider: "grok",
        model: "provsvar",
        apiKey: "prov",
        baseURL,
        traits: TRAITS.grok,
      },
    });

    let finished = await readDraftJob(job.id, null);
    for (let i = 0; i < 200 && finished && (finished.status === "queued" || finished.status === "running"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finished = await readDraftJob(job.id, null);
    }
    mode = "svara";

    expect(finished?.status).toBe("done");
    expect(finished?.variants).toHaveLength(0);
    // Det här är hela poängen: kunden ska kunna läsa varför.
    expect(finished?.summary).toContain("nådde taket");
    expect(finished?.detail.model).toBe("provsvar");
    expect(finished?.detail.steps?.length).toBeGreaterThan(0);
    expect(finished?.detail.stopReason).toBe("max_rounds");
  }, 30_000);
});


describe("samma misslyckade anrop om och om igen", () => {
  it("avbryter i stället för att köra tills rundorna tar slut", async () => {
    mode = "trasigt";
    const result = await runAssistant({
      config: defaultConfig(),
      message: "Bygg linjen.",
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      // Taket är högt; spärren ska slå till långt innan.
      maxRounds: 16,
      provider: {
        provider: "grok",
        model: "provsvar",
        apiKey: "prov",
        baseURL,
        traits: TRAITS.grok,
      },
    });
    mode = "svara";

    expect(result.stopReason).toBe("repeat");
    expect(result.rounds).toBe(3);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((step) => !step.ok)).toBe(true);
    // Kunden ska få veta det, inte bara loggen.
    expect(result.text).toContain("fastnade");
  }, 20_000);
});

describe("samma fel fast anropet varieras", () => {
  it("räknar felet, inte argumenten", async () => {
    // Servern varierar maskin-id:t varje gång men får samma sorts fel. En
    // modell som är fast brukar just småändra i stället för att upprepa exakt.
    let variant = 0;
    const varying = createServer((request, response) => {
      variant += 1;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(toolUseMessage("add_machine", { machineId: `finns-inte-${variant}` }));
    });
    await new Promise<void>((resolve) => varying.listen(0, "127.0.0.1", resolve));
    const address = varying.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const result = await runAssistant({
      config: defaultConfig(),
      message: "Bygg linjen.",
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      maxRounds: 16,
      provider: {
        provider: "grok",
        model: "provsvar",
        apiKey: "prov",
        baseURL: url,
        traits: TRAITS.grok,
      },
    });
    varying.close();

    expect(result.stopReason).toBe("repeat");
    expect(result.rounds).toBeLessThanOrEqual(4);
  }, 20_000);
});

describe("jobbet när assistenten fastnar", () => {
  it("lämnar en läsbar förklaring i stället för tystnad", async () => {
    mode = "trasigt";
    const job = await startDraftJob({
      config: defaultConfig(),
      note: "Gör ett förslag på denna ritning.",
      attachments: [{ name: "ritning.png", mediaType: "image/png", data: "AAAA" }],
      userId: null,
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      provider: {
        provider: "grok",
        model: "provsvar",
        apiKey: "prov",
        baseURL,
        traits: TRAITS.grok,
      },
    });

    let finished = await readDraftJob(job.id, null);
    for (let i = 0; i < 200 && finished && (finished.status === "queued" || finished.status === "running"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finished = await readDraftJob(job.id, null);
    }
    mode = "svara";

    expect(finished?.status).toBe("done");
    expect(finished?.summary).toContain("fastnade");
    expect(finished?.detail.stopReason).toBe("repeat");
    // Och det ska inte ha kostat sexton rundor att komma dit.
    expect(finished?.detail.rounds).toBeLessThanOrEqual(4);
  }, 30_000);
});

describe("jobbet ger en tur till när bara lokalen ritades", () => {
  it("bygger linjen i en andra tur i stället för att lämna ett halvt svar", async () => {
    /*
     * Första turen ritar hallen och sparar ett förslag utan maskiner — precis
     * som det gick i verkligheten. Andra turen ska då komma, med lokalen på
     * plats, och lägga till maskinen.
     */
    let turn = 0;
    let calls = 0;
    const server = createServer((request, response) => {
      calls += 1;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      if (turn === 0) {
        if (calls === 1) return void response.end(toolUseMessage("draw_hall", { lengthM: 15, widthM: 9 }));
        if (calls === 2) {
          return void response.end(
            toolUseMessage("propose_variant", { name: "Lokalen", description: "Bara hallen." }),
          );
        }
        turn = 1;
        calls = 0;
        return void response.end(textInBlockMessage("Jag ritade lokalen."));
      }
      if (calls === 1) {
        return void response.end(toolUseMessage("add_machine", { machineId: "rullbana" }));
      }
      if (calls === 2) {
        return void response.end(
          toolUseMessage("propose_variant", { name: "Med linje", description: "Hall och linje." }),
        );
      }
      response.end(textInBlockMessage("Nu står linjen också."));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const job = await startDraftJob({
      // Som när kunden väljer "Ladda upp ritning": tom ritning, inga maskiner.
      config: emptyConfig(),
      note: "Gör ett förslag på ritningen.",
      attachments: [{ name: "ritning.png", mediaType: "image/png", data: "AAAA" }],
      userId: null,
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      provider: {
        provider: "grok",
        model: "provsvar",
        apiKey: "prov",
        baseURL: url,
        traits: TRAITS.grok,
      },
    });

    let finished = await readDraftJob(job.id, null);
    for (let i = 0; i < 200 && finished && (finished.status === "queued" || finished.status === "running"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finished = await readDraftJob(job.id, null);
    }
    server.close();

    expect(finished?.status).toBe("done");
    // Två förslag, och det med maskiner ligger först.
    expect(finished?.variants).toHaveLength(2);
    expect(finished?.variants[0].name).toBe("Med linje");
    // Rapporten visar hela arbetet, båda turerna.
    expect(finished?.detail.steps?.map((s) => s.name)).toContain("add_machine");
    expect(finished?.detail.rounds).toBeGreaterThan(3);
  }, 30_000);
});
