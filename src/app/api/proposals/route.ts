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

const saveSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  config: configurationSchema,
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
  const proposals = (await listProposals(user.id)).map(({ config: _config, ...rest }) => rest);
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
