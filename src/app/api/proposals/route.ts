import { NextResponse } from "next/server";
import { z } from "zod";
import { configurationSchema } from "@/lib/schema";
import { quoteReference } from "@/lib/quote";
import { currentUser } from "@/lib/server/session";
import { deleteProposal, listProposals, readProposal, saveProposal } from "@/lib/server/store";
import type { Configuration } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kundens sparade förslag.
 *
 * Allt går genom den inloggade användaren — id:t kommer aldrig från
 * klienten, och varje läsning och skrivning filtreras på det. Ett förslag är
 * kundens eget arbete och ska inte gå att nå med en gissad adress.
 */

/** Loggen sparas som den är, men inte i vilken storlek som helst. */
const logSchema = z
  .array(
    z.object({
      id: z.string().max(64),
      at: z.string().max(40),
      kind: z.string().max(32),
      text: z.string().max(400),
      detail: z.string().max(4000).optional(),
    }),
  )
  .max(400);

const saveSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  config: configurationSchema,
  log: logSchema.default([]),
});

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Kräver inloggning." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const proposal = await readProposal(id, user.id);
    if (!proposal) return NextResponse.json({ error: "Hittades inte." }, { status: 404 });
    return NextResponse.json({ proposal });
  }

  // Listan bär inte konfigurationerna: den ska vara billig att hämta ofta.
  // Listan bär varken konfiguration eller logg: den ska vara billig att hämta.
  const proposals = (await listProposals(user.id)).map(
    ({ config: _config, log: _log, ...rest }) => rest,
  );
  return NextResponse.json({ proposals });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Kräver inloggning." }, { status: 401 });

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltigt förslag." }, { status: 400 });
  }

  const config = parsed.data.config as Configuration;
  const id = parsed.data.id ?? `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const result = await saveProposal({
    id,
    userId: user.id,
    name: parsed.data.name,
    reference: quoteReference(config),
    config,
    log: parsed.data.log,
  });

  return NextResponse.json({ ok: true, id, ...result });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Kräver inloggning." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Id saknas." }, { status: 400 });

  await deleteProposal(id, user.id);
  return NextResponse.json({ ok: true });
}
