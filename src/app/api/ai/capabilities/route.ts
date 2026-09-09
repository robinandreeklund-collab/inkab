import { NextResponse } from "next/server";
import { activeProvider } from "@/lib/server/aiRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vad assistenten kan ta emot just nu.
 *
 * Klienten behöver veta det innan den skickar: en pdf som mottagaren inte kan
 * läsa ska göras om till sidbilder i webbläsaren, inte avvisas efteråt med ett
 * felmeddelande som kunden inte kan göra något åt.
 *
 * Svaret säger vad som går, inte vem som svarar. Vilken modell INKAB kör mot
 * är en driftfråga och hör hemma i admin.
 */
export async function GET() {
  const provider = await activeProvider();
  return NextResponse.json({
    configured: !!provider,
    acceptsImages: provider?.traits.images ?? false,
    acceptsPdf: provider?.traits.documents ?? false,
  });
}
