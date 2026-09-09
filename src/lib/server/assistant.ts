import "server-only";

/**
 * Vilken modell assistenten går mot.
 *
 * Valet är en driftinställning, inte en egenskap hos verktyget: samma
 * verktygsskal, samma systemprompt och samma regelmotor ligger under, och det
 * som byts ut är motorn som resonerar. Därför sitter valet i admin och inte i
 * koden.
 *
 * Nycklarna gör inte samma resa. De läses ur miljön och skrivs aldrig via
 * webben: en nyckel som går att spara i ett formulär går också att läsa ut ur
 * en databas. Admin ser om en nyckel finns, inte vad den är.
 */

export type AssistantProvider = "anthropic" | "grok";

export type AssistantSettings = {
  provider: AssistantProvider;
  anthropicModel: string;
  grokModel: string;
  /**
   * Byt modell när den valda inte klarar verktygsanropen.
   *
   * En modell som anropar verktygen utan argument kommer inte vidare hur många
   * rundor den än får. Då är det bättre att göra om jobbet med den andra
   * modellen än att lämna kunden utan svar — och säga att det gjordes.
   */
  failover: boolean;
};

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  provider: "anthropic",
  anthropicModel: "claude-opus-5",
  grokModel: "grok-4",
  failover: true,
};

/** xAI svarar på Anthropics eget protokoll, så samma klient duger. */
export const GROK_BASE_URL = process.env.XAI_BASE_URL ?? "https://api.x.ai";

export const PROVIDER_LABEL: Record<AssistantProvider, string> = {
  anthropic: "Anthropic · Claude",
  grok: "xAI · Grok",
};

export function anthropicKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null;
}

export function grokKey(): string | null {
  return process.env.XAI_API_KEY || process.env.GROK_API_KEY || null;
}

export function keyStatus(): Record<AssistantProvider, boolean> {
  return { anthropic: !!anthropicKey(), grok: !!grokKey() };
}

/**
 * Vad leverantören går med på.
 *
 * Adaptivt tänkande, ansträngningsnivå och promptcache är Anthropics egna
 * tillägg. xAI tar emot samma anrop i övrigt, men de fälten hör inte hemma
 * där — och ett fält för mycket är ett 400 i stället för ett svar.
 */
export type ProviderTraits = {
  thinking: boolean;
  effort: boolean;
  promptCache: boolean;
  strictTools: boolean;
  /** Bilder i meddelandet. */
  images: boolean;
  /** Pdf som dokument, med text och allt. Annars görs den om till sidbilder. */
  documents: boolean;
};

export const TRAITS: Record<AssistantProvider, ProviderTraits> = {
  anthropic: {
    thinking: true,
    effort: true,
    promptCache: true,
    strictTools: true,
    images: true,
    documents: true,
  },
  /*
   * xAI svarar på Anthropics protokoll men inte på allt som finns i det.
   * Bilder går in; ett dokumentblock med en pdf ger 422, så pdf:en görs om
   * till sidbilder i webbläsaren innan den skickas.
   */
  grok: {
    thinking: false,
    effort: false,
    promptCache: false,
    strictTools: false,
    images: true,
    documents: false,
  },
};

export type ResolvedProvider = {
  provider: AssistantProvider;
  model: string;
  apiKey: string;
  baseURL?: string;
  traits: ProviderTraits;
};

/**
 * Väljer leverantör enligt inställningen, men aldrig en utan nyckel: hellre
 * den som fungerar än ett fel kunden inte kan göra något åt. Saknas båda
 * returneras null och anropet degraderar till regelmotorn.
 */
/** Den andra leverantören, om den har en nyckel. Null när det inte finns någon. */
export function otherProvider(
  settings: AssistantSettings,
  current: AssistantProvider,
): ResolvedProvider | null {
  const other: AssistantProvider = current === "grok" ? "anthropic" : "grok";
  const apiKey = other === "grok" ? grokKey() : anthropicKey();
  if (!apiKey) return null;
  return {
    provider: other,
    model: other === "grok" ? settings.grokModel : settings.anthropicModel,
    apiKey,
    baseURL: other === "grok" ? GROK_BASE_URL : undefined,
    traits: TRAITS[other],
  };
}

export function resolveProvider(settings: AssistantSettings): ResolvedProvider | null {
  const order: AssistantProvider[] =
    settings.provider === "grok" ? ["grok", "anthropic"] : ["anthropic", "grok"];

  for (const provider of order) {
    const apiKey = provider === "grok" ? grokKey() : anthropicKey();
    if (!apiKey) continue;
    return {
      provider,
      model: provider === "grok" ? settings.grokModel : settings.anthropicModel,
      apiKey,
      baseURL: provider === "grok" ? GROK_BASE_URL : undefined,
      traits: TRAITS[provider],
    };
  }
  return null;
}
