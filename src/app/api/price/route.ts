import { NextResponse } from "next/server";
import { configurationSchema } from "@/lib/schema";
import { canSeePrices, priceConfiguration } from "@/lib/server/pricing";
import { currentRole, currentUser } from "@/lib/server/session";
import { activeContext } from "@/lib/server/context";
import { proposalAdjustment } from "@/lib/server/store";
import type { Configuration } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Prissättning sker alltid här. Klienten ser aldrig prisboken.
 *
 * Offertens rabatt kommer inte heller från klienten: den slås upp i lagret på
 * det id som skickas med. Annars kunde vem som helst sätta sitt eget pris genom
 * att skriva om anropet, och en prisuppgift som går att skriva om själv är inte
 * en prisuppgift.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  // Klienten skickar antingen konfigurationen rakt av, som förut, eller
  // konfigurationen tillsammans med id:t på offerten den hör till.
  const wrapped: { config: unknown; proposalId?: unknown } =
    body && typeof body === "object" && "config" in body
      ? (body as { config: unknown; proposalId?: unknown })
      : { config: body };

  const parsed = configurationSchema.safeParse(wrapped.config);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltig konfiguration." }, { status: 400 });
  }

  const role = await currentRole();
  const { library, priceBook } = await activeContext();

  let adjustment = null;
  if (typeof wrapped.proposalId === "string" && wrapped.proposalId) {
    const found = await proposalAdjustment(wrapped.proposalId);
    const user = await currentUser();
    // Justeringen gäller den som äger offerten och den som säljer den.
    if (found && (canSeePrices(role) || found.userId === user?.id)) {
      adjustment = found.adjustment;
    }
  }

  return NextResponse.json(
    priceConfiguration(parsed.data as Configuration, role, library, priceBook, adjustment),
  );
}
