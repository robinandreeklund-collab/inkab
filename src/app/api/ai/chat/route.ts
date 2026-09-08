import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { configurationSchema } from "@/lib/schema";
import { currentRole } from "@/lib/server/session";
import { activeContext } from "@/lib/server/context";
import { buildSystem } from "@/lib/ai/prompt";
import { executeTool, toolDefinitions, type ToolContext } from "@/lib/ai/tools";
import { ruleBasedSuggestions } from "@/lib/ai/fallback";
import type { Configuration } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Tak per tur så att en felresonerande modell inte kan loopa i all evighet. */
const MAX_TOOL_ROUNDS = 12;
const MODEL = "claude-opus-5";

const bodySchema = z.object({
  config: configurationSchema,
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
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

  const { config, message, history } = parsed.data;
  const role = await currentRole();
  const { library, priceBook } = await activeContext();

  // Utan nyckel degraderar assistenten till regelmotorns egna förslag.
  if (!process.env.ANTHROPIC_API_KEY) {
    const { text, suggestions } = ruleBasedSuggestions(config as Configuration, library);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(sse("text", { text }));
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

  const client = new Anthropic();
  const ctx: ToolContext = {
    original: JSON.parse(JSON.stringify(config)),
    draft: JSON.parse(JSON.stringify(config)),
    variants: [],
    role,
    library,
    priceBook,
  };

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    {
      role: "user" as const,
      content:
        `Kundens nuvarande konfiguration:\n${JSON.stringify(config, null, 2)}\n\n` +
        `Kundens fråga: ${message}`,
    },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(sse(event, data));

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const response = client.messages.stream({
            model: MODEL,
            max_tokens: 16000,
            thinking: { type: "adaptive", display: "summarized" },
            output_config: { effort: "high" },
            system: buildSystem(library),
            tools: toolDefinitions(library),
            messages,
          });

          let currentBlock: "thinking" | "text" | null = null;
          for await (const event of response) {
            if (event.type === "content_block_start") {
              currentBlock =
                event.content_block.type === "thinking"
                  ? "thinking"
                  : event.content_block.type === "text"
                    ? "text"
                    : null;
              if (event.content_block.type === "tool_use") {
                send("tool", { name: event.content_block.name, phase: "start" });
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "thinking_delta" && currentBlock === "thinking") {
                send("thinking", { text: event.delta.thinking });
              } else if (event.delta.type === "text_delta" && currentBlock === "text") {
                send("text", { text: event.delta.text });
              }
            } else if (event.type === "content_block_stop") {
              currentBlock = null;
            }
          }

          const final = await response.finalMessage();
          messages.push({ role: "assistant", content: final.content });

          if (final.stop_reason === "refusal") {
            send("text", {
              text: "\n\nJag kan inte hjälpa till med den frågan. Prova att formulera om den.",
            });
            break;
          }

          if (final.stop_reason !== "tool_use") break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            send("tool", { name: block.name, phase: "run" });
            let output: unknown;
            try {
              output = executeTool(block.name, block.input as Record<string, unknown>, ctx);
            } catch (error) {
              output = { error: error instanceof Error ? error.message : "Verktyget misslyckades." };
            }
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          }
          messages.push({ role: "user", content: results });
        }

        send("done", {
          variants: ctx.variants.map((v) => ({
            id: v.id,
            name: v.name,
            description: v.description,
            config: v.config,
          })),
          aiConfigured: true,
        });
      } catch (error) {
        send("error", { message: describeError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders() });
}

/** Översätter API-fel till något som går att agera på. */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401) {
      return "ANTHROPIC_API_KEY avvisades (401). Kontrollera att nyckeln är rätt kopierad och sparad under Environment Variables.";
    }
    if (error.status === 429) {
      return "Anthropic svarade 429 — för många anrop just nu. Prova igen om en stund.";
    }
    if (error.status === 400) {
      return `Anthropic avvisade förfrågan (400): ${error.message}`;
    }
    return `Assistenten svarade inte (${error.status}). Verktyget fungerar utan den.`;
  }
  return "Assistenten är tillfälligt otillgänglig. Verktyget fungerar utan den.";
}

function streamHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}
