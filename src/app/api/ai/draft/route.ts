import { NextResponse } from "next/server";
import { z } from "zod";
import { configurationSchema } from "@/lib/schema";
import { currentRole, currentUser } from "@/lib/server/session";
import { activeContext } from "@/lib/server/context";
import { startDraftJob } from "@/lib/server/draftJobs";
import { activeProvider } from "@/lib/server/aiRun";
import { listDraftJobs } from "@/lib/server/store";
import { attachmentSchema, MAX_ATTACHMENTS, MAX_TOTAL_CHARS } from "@/lib/server/attachmentSchema";
import type { Configuration } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Beställ ett förslag byggt ur ett underlag.
 *
 * Svaret är ett id, inte ett förslag: arbetet fortsätter på servern och kunden
 * ritar vidare under tiden. Id:t är hemligt och räcker som nyckel för den som
 * inte är inloggad.
 */

const startSchema = z.object({
  config: configurationSchema,
  note: z.string().max(2000).default(""),
  attachments: z.array(attachmentSchema).min(1).max(MAX_ATTACHMENTS),
});

export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Underlaget gick inte att läsa. Ladda upp minst en bild eller pdf." },
      { status: 400 },
    );
  }

  const { config, note, attachments } = parsed.data;
  if (attachments.reduce((sum, a) => sum + a.data.length, 0) > MAX_TOTAL_CHARS) {
    return NextResponse.json(
      { error: "Bilagorna är för stora tillsammans. Skicka färre eller mindre filer." },
      { status: 413 },
    );
  }

  const provider = await activeProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "Assistenten är inte påslagen på den här servern (ingen modellnyckel är satt), " +
          "så underlaget kan inte läsas. Rita hallen för hand så länge.",
      },
      { status: 503 },
    );
  }

  const [user, role, context] = await Promise.all([currentUser(), currentRole(), activeContext()]);
  const job = await startDraftJob({
    config: config as Configuration,
    note,
    attachments,
    userId: user?.id ?? null,
    role,
    library: context.library,
    priceBook: context.priceBook,
    provider,
  });

  return NextResponse.json({ job: { id: job.id, status: job.status, step: job.step } });
}

/** Kontots jobb. Utan konto håller klienten reda på sitt eget id. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ jobs: [] });
  const jobs = (await listDraftJobs(user.id)).map(({ variants, ...rest }) => ({
    ...rest,
    variantCount: variants.length,
  }));
  return NextResponse.json({ jobs });
}
