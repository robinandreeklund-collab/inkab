import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { ASSISTANT_SETTINGS_ID, assistantSettings, runAssistant } from "@/lib/server/aiRun";
import { activeContext } from "@/lib/server/context";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  keyStatus,
  resolveProvider,
  type AssistantSettings,
} from "@/lib/server/assistant";
import { writeSetting } from "@/lib/server/store";
import { defaultConfig } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Assistentens driftinställningar.
 *
 * Bara admin, och aldrig nycklar: svaret säger om en nyckel finns, inte vad
 * den innehåller. Nycklar sätts i miljön där servern kör.
 */

const settingsSchema = z.object({
  provider: z.enum(["anthropic", "grok"]),
  anthropicModel: z.string().min(1).max(80),
  grokModel: z.string().min(1).max(80),
  failover: z.boolean().default(true),
});

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }
  const settings = await assistantSettings();
  return NextResponse.json({
    settings,
    keys: keyStatus(),
    defaults: DEFAULT_ASSISTANT_SETTINGS,
    active: resolveProvider(settings)?.provider ?? null,
  });
}

export async function PUT(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltiga inställningar." }, { status: 400 });
  }

  const settings = parsed.data as AssistantSettings;
  const result = await writeSetting(ASSISTANT_SETTINGS_ID, settings);
  return NextResponse.json({
    ok: true,
    settings,
    active: resolveProvider(settings)?.provider ?? null,
    persisted: result.persisted,
    reason: result.reason,
  });
}

/**
 * Provkör den valda leverantören.
 *
 * En riktig fråga med riktiga verktyg, inte ett pingsvar: det som brukar
 * skilja leverantörer åt är just verktygsanropen, och ett "hej" tillbaka
 * bevisar ingenting om att assistenten fungerar.
 */
export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  const settings = parsed.success ? (parsed.data as AssistantSettings) : await assistantSettings();
  const provider = resolveProvider(settings);
  if (!provider) {
    return NextResponse.json({
      ok: false,
      error: "Ingen nyckel är satt för någon leverantör.",
    });
  }

  const { library, priceBook } = await activeContext();
  const started = Date.now();
  const run = await runAssistant({
    config: defaultConfig(),
    message:
      "Detta är ett driftprov. Anropa get_current_layout en gång och svara sedan med " +
      "en mening om vad linjen består av. Spara inget förslag.",
    role: "admin",
    library,
    priceBook,
    provider,
    maxRounds: 3,
    effort: "low",
  });

  return NextResponse.json({
    ok: !run.error,
    provider: provider.provider,
    model: provider.model,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    rounds: run.rounds,
    answer: run.text.slice(0, 400),
    error: run.error,
  });
}
