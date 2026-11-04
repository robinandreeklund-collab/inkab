import { NextResponse } from "next/server";
import { computeLayout } from "@/lib/layout";
import { defaultConfig } from "@/lib/templates";
import { readDocument, storeStatus } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hälsokontroll för Render. Kör en riktig layoutberäkning så att en trasig
 *  motor upptäcks direkt vid deploy i stället för av första kunden.
 *
 *  Säger också vilken commit som körs och vilka maskiner biblioteket har —
 *  "jag ser inte maskinen" ska gå att svara på utan att gissa vilken gren
 *  Render byggde. */
export async function GET() {
  try {
    const layout = computeLayout(defaultConfig());
    const [document, store] = await Promise.all([readDocument(), storeStatus()]);
    return NextResponse.json({
      status: "ok",
      commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
      branch: process.env.RENDER_GIT_BRANCH ?? null,
      storage: store.mode,
      seedSource: store.seedSource,
      libraryMachines: document.machines.map((m) => m.id),
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
