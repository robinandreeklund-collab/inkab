import { NextResponse } from "next/server";
import { computeLayout } from "@/lib/layout";
import { defaultConfig } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hälsokontroll för Render. Kör en riktig layoutberäkning så att en trasig
 *  motor upptäcks direkt vid deploy i stället för av första kunden. */
export async function GET() {
  try {
    const layout = computeLayout(defaultConfig());
    return NextResponse.json({
      status: "ok",
      machines: layout.placements.length,
      errors: layout.diagnostics.filter((d) => d.severity === "error").length,
      aiConfigured: !!process.env.ANTHROPIC_API_KEY,
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}
