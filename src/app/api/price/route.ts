import { NextResponse } from "next/server";
import { configurationSchema } from "@/lib/schema";
import { priceConfiguration } from "@/lib/server/pricing";
import { currentRole } from "@/lib/server/session";
import type { Configuration } from "@/lib/types";

export const runtime = "nodejs";

/** Prissättning sker alltid här. Klienten ser aldrig prisboken. */
export async function POST(request: Request) {
  const parsed = configurationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltig konfiguration." }, { status: 400 });
  }
  const role = await currentRole();
  return NextResponse.json(priceConfiguration(parsed.data as Configuration, role));
}
