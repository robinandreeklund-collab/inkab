import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  keyStatus,
  resolveProvider,
  TRAITS,
} from "@/lib/server/assistant";
import Anthropic from "@anthropic-ai/sdk";
import { describeError, providerSystem, providerTools, runAssistant } from "@/lib/server/aiRun";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { defaultConfig } from "@/lib/templates";

/**
 * Vilken modell assistenten går mot.
 *
 * Det som kan gå fel här är av två slag: att valet inte följs, och att ett
 * anrop skickas med fält som mottagaren inte känner igen. Det senare syns
 * inte som ett dåligt svar utan som ett 400 — alltså inget svar alls — och
 * går bara att fånga före det första riktiga anropet.
 */

const KEYS = ["ANTHROPIC_API_KEY", "XAI_API_KEY", "GROK_API_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const only = (...present: string[]) => {
  for (const key of KEYS) delete process.env[key];
  for (const key of present) process.env[key] = "test-key";
};

describe("val av leverantör", () => {
  it("följer inställningen när nyckeln finns", () => {
    only("XAI_API_KEY", "ANTHROPIC_API_KEY");
    const grok = resolveProvider({ ...DEFAULT_ASSISTANT_SETTINGS, provider: "grok" });
    expect(grok?.provider).toBe("grok");
    expect(grok?.model).toBe(DEFAULT_ASSISTANT_SETTINGS.grokModel);
    expect(grok?.baseURL).toContain("x.ai");

    const claude = resolveProvider({ ...DEFAULT_ASSISTANT_SETTINGS, provider: "anthropic" });
    expect(claude?.provider).toBe("anthropic");
    expect(claude?.baseURL).toBeUndefined();
  });

  it("faller tillbaka på den leverantör som har en nyckel", () => {
    only("ANTHROPIC_API_KEY");
    const chosen = resolveProvider({ ...DEFAULT_ASSISTANT_SETTINGS, provider: "grok" });
    // Hellre den som fungerar än ett fel kunden inte kan göra något åt.
    expect(chosen?.provider).toBe("anthropic");
  });

  it("tar GROK_API_KEY som alternativt namn", () => {
    only("GROK_API_KEY");
    expect(resolveProvider({ ...DEFAULT_ASSISTANT_SETTINGS, provider: "grok" })?.provider).toBe(
      "grok",
    );
    expect(keyStatus()).toEqual({ anthropic: false, grok: true });
  });

  it("ger null när ingen nyckel finns", () => {
    only();
    expect(resolveProvider(DEFAULT_ASSISTANT_SETTINGS)).toBeNull();
  });
});

describe("anpassning till leverantören", () => {
  const grok = {
    provider: "grok" as const,
    model: "grok-4",
    apiKey: "x",
    baseURL: "https://api.x.ai",
    traits: TRAITS.grok,
  };
  const anthropic = {
    provider: "anthropic" as const,
    model: "claude-opus-5",
    apiKey: "x",
    traits: TRAITS.anthropic,
  };

  it("skickar inte promptcache till den som inte har den", () => {
    const forGrok = providerSystem(BUILTIN_LIBRARY, grok);
    expect(forGrok.some((block) => "cache_control" in block)).toBe(false);
    // Innehållet är detsamma; det är bara Anthropics tillägg som faller bort.
    expect(forGrok.map((b) => b.text)).toEqual(
      providerSystem(BUILTIN_LIBRARY, anthropic).map((b) => b.text),
    );
  });

  it("behåller promptcachen för Anthropic", () => {
    expect(
      providerSystem(BUILTIN_LIBRARY, anthropic).some((block) => "cache_control" in block),
    ).toBe(true);
  });

  it("tar bort strict ur verktygen för den som inte känner flaggan", () => {
    const tools = providerTools(BUILTIN_LIBRARY, grok);
    expect(tools.every((tool) => !("strict" in tool))).toBe(true);
    // Namn och scheman är oförändrade — serverns egen validering gäller ändå.
    expect(tools.map((t) => t.name)).toEqual(
      providerTools(BUILTIN_LIBRARY, anthropic).map((t) => t.name),
    );
    expect(
      providerTools(BUILTIN_LIBRARY, anthropic).every(
        (tool) => (tool as { strict?: boolean }).strict === true,
      ),
    ).toBe(true);
  });
});

describe("bilagor som leverantören inte klarar", () => {
  const grok = {
    provider: "grok" as const,
    model: "grok-4",
    apiKey: "x",
    baseURL: "https://api.x.ai",
    traits: TRAITS.grok,
  };

  it("stoppar en pdf innan den blir ett 422", async () => {
    const run = await runAssistant({
      config: defaultConfig(),
      message: "Rita upp lokalen.",
      attachments: [{ name: "ritning.pdf", mediaType: "application/pdf", data: "AAAA" }],
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      provider: grok,
    });
    // Inget anrop gjordes: felet kommer före nätet.
    expect(run.rounds).toBe(0);
    expect(run.error).toContain("kan inte läsa pdf");
  });

  it("släpper igenom bilder", async () => {
    // Bilder är tillåtna, så körningen går vidare till anropet — och faller
    // där, på en påhittad nyckel. Det är skillnaden vi vill se.
    const run = await runAssistant({
      config: defaultConfig(),
      message: "Rita upp lokalen.",
      attachments: [{ name: "sida.png", mediaType: "image/png", data: "AAAA" }],
      role: "guest",
      library: BUILTIN_LIBRARY,
      priceBook: BUILTIN_PRICE_BOOK,
      provider: { ...grok, baseURL: "http://127.0.0.1:1" },
    });
    expect(run.error).not.toContain("kan inte läsa");
  });
});

describe("felmeddelanden från leverantören", () => {
  const apiError = (status: number, body: object) =>
    new Anthropic.APIError(status, body, "fel", new Headers());

  it("återger vad leverantören faktiskt sa", () => {
    const text = describeError(
      apiError(422, { error: { message: "document blocks are not supported" } }),
    );
    expect(text).toContain("422");
    expect(text).toContain("document blocks are not supported");
  });

  it("tar meddelandet även när det ligger i roten", () => {
    expect(describeError(apiError(500, { message: "internal" }))).toContain("internal");
  });

  it("säger till om nyckeln när svaret är 401 eller 403", () => {
    for (const status of [401, 403]) {
      expect(describeError(apiError(status, { error: { message: "bad key" } }))).toContain(
        "Nyckeln avvisades",
      );
    }
  });

  it("skyller inte på leverantören när felet inte kom därifrån", () => {
    expect(describeError(new Error("nätet dog"))).toContain("tillfälligt otillgänglig");
  });
});
