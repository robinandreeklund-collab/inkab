import { NextResponse } from "next/server";
import { z } from "zod";
import { configurationSchema } from "@/lib/schema";
import { currentRole } from "@/lib/server/session";
import { activeContext } from "@/lib/server/context";
import { activeProvider, runAssistant } from "@/lib/server/aiRun";
import { ruleBasedSuggestions } from "@/lib/ai/fallback";
import { attachmentSchema, MAX_ATTACHMENTS, MAX_TOTAL_CHARS } from "@/lib/server/attachmentSchema";
import type { Configuration } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  config: configurationSchema,
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).default([]),
});

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // Säg vad som faktiskt är fel. Ett naket 400 gör det omöjligt att se om
    // klienten skickar en konfiguration som servern inte känner igen — t.ex.
    // efter en deploy där schemat och klienten hunnit glida isär.
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(roten)"}: ${i.message}`);
    return NextResponse.json(
      {
        error:
          "Servern kunde inte läsa konfigurationen. Ofta betyder det att sidan " +
          "är äldre än servern — ladda om med Ctrl+F5.",
        issues,
      },
      { status: 400 },
    );
  }

  const { config, message, history, attachments } = parsed.data;

  if (attachments.reduce((sum, a) => sum + a.data.length, 0) > MAX_TOTAL_CHARS) {
    return NextResponse.json(
      {
        error:
          "Bilagorna är för stora tillsammans. Skicka färre eller mindre filer — " +
          "en skärmbild av ritningen räcker oftast.",
      },
      { status: 413 },
    );
  }

  const role = await currentRole();
  const { library, priceBook } = await activeContext();
  const provider = await activeProvider();

  // Utan nyckel degraderar assistenten till regelmotorns egna förslag.
  if (!provider) {
    const { text, suggestions } = ruleBasedSuggestions(config as Configuration, library);
    const prefix = attachments.length
      ? "Jag kan inte läsa bifogade filer utan att assistenten är påslagen — " +
        "ingen modellnyckel är satt på servern. Här är vad regelmotorn ser i stället.\n\n"
      : "";
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(sse("text", { text: prefix + text }));
          controller.enqueue(
            sse("done", {
              variants: suggestions.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description,
                config: s.config,
              })),
              aiConfigured: false,
            }),
          );
          controller.close();
        },
      }),
      { headers: streamHeaders() },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(sse(event, data));

      const run = await runAssistant({
        config: config as Configuration,
        message,
        history,
        attachments,
        role,
        library,
        priceBook,
        provider,
        onEvent: (event) => {
          if (event.type === "tool") send("tool", { name: event.name, phase: event.phase });
          else if (event.type === "error") send("error", { message: event.message });
          else send(event.type, { text: event.text });
        },
      });

      if (!run.error) {
        send("done", {
          variants: run.variants.map((v) => ({
            id: v.id,
            name: v.name,
            description: v.description,
            config: v.config,
          })),
          aiConfigured: true,
          // Vad som faktiskt gjordes. Behövs när svaret blev tomt: då är det
          // enda beskedet kunden kan få.
          trace: { rounds: run.rounds, stopReason: run.stopReason, steps: run.steps },
        });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: streamHeaders() });
}

function streamHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}
