import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  keyStatus,
  resolveProvider,
  TRAITS,
} from "@/lib/server/assistant";
import { providerSystem, providerTools } from "@/lib/server/aiRun";
import { BUILTIN_LIBRARY } from "@/lib/library";

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
