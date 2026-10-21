import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { configurationSchema } from "@/lib/schema";
import { quoteReference } from "@/lib/quote";
import { currentUser } from "@/lib/server/session";
import { submitProposal } from "@/lib/server/store";
import type { Configuration } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kunden skickar in sitt underlag till INKAB.
 *
 * Sista steget i offerten, och det enda stället i verktyget där kunden
 * lämnar ifrån sig något. Därför:
 *
 *  — Ingen inloggning krävs. Den som byggt en anläggning i en kvart ska
 *    inte behöva skaffa ett konto för att höra av sig. Är kunden inloggad
 *    hamnar inskickningen på kontot i stället, så att den syns bland
 *    "Mina förslag".
 *  — Konfigurationen går genom samma validering som allt annat. Klienten är
 *    aldrig betrodd, inte heller i ett formulär.
 *  — Inget pris räknas här. Priset är INKAB:s sak och sätts i adminvyn; vad
 *    kunden tror att anläggningen kostar är inte en del av inskickningen.
 *
 * Svaret bär underlagsnumret. Det är vad kunden har kvar efteråt, och vad
 * säljaren känner igen offerten på.
 */

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  company: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  message: z.string().trim().max(2000).optional(),
});

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

const submitSchema = z.object({
  /** Den öppnade offerten, när kunden arbetar i en sparad. */
  id: z.string().min(1).max(64).optional(),
  config: configurationSchema,
  contact: contactSchema,
  log: logSchema.default([]),
});

/**
 * Facket en inskickning utan konto hamnar i.
 *
 * Id:t härleds ur e-postadressen så att samma kund som skickar in två
 * anläggningar hamnar på samma fack, och det hashas så att adressen inte
 * ligger i klartext i en nyckel. Det är inget konto: ingen kan logga in på
 * det, och det ger ingen åtkomst till något.
 */
function guestBucket(email: string): string {
  const digest = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `guest-${digest.slice(0, 24)}`;
}

export async function POST(request: Request) {
  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: "Underlaget kunde inte skickas in.",
        field: issue?.path.join(".") ?? null,
      },
      { status: 400 },
    );
  }

  const user = await currentUser();
  const { contact, config: validated } = parsed.data;
  const config = validated as unknown as Configuration;
  const reference = quoteReference(config);
  /*
   * En inloggad kund skriver till sin egen offert; samma id som autosparet
   * använder, så att inskickningen inte blir en kopia bredvid originalet.
   * En gäst får en ny rad per inskickning — det finns inget konto att slå
   * ihop den med, och två underlag från samma adress är inte samma affär.
   */
  const id =
    (user ? parsed.data.id : null) ??
    `q-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const result = await submitProposal({
    id,
    userId: user?.id ?? guestBucket(contact.email),
    name: config.projectName || reference,
    reference,
    config,
    log: parsed.data.log,
    contact: { ...contact, submittedAt: new Date().toISOString() },
  });

  return NextResponse.json({ ok: true, id, reference, ...result });
}
