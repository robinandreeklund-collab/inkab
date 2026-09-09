import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { runAssistant, type AssistantRun } from "@/lib/server/aiRun";
import { TRAITS } from "@/lib/server/assistant";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { defaultConfig } from "@/lib/templates";
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
function toolUseMessage(name: string): string {
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
      delta: { type: "input_json_delta", partial_json: "{}" },
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
/** "svara" gör ett verktygsanrop och sedan text; "loopa" anropar i all evighet. */
let mode: "svara" | "loopa" = "svara";

beforeAll(async () => {
  server = createServer((request, response) => {
    calls += 1;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
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
