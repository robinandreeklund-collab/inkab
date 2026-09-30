import { NextResponse } from "next/server";
import { bundleEntries, bundleFileName, planDemoBundle, referencedModelIds } from "@/lib/demoBundle";
import { createZip } from "@/lib/zip";
import { currentRole } from "@/lib/server/session";
import { readDocument, readModel } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Demo-paketet: biblioteket och modellerna som ett arkiv att packa upp i repot.
 *
 * Utan DATABASE_URL lever uppladdade modeller bara i serverns minne. Den här
 * rutten gör om dem till repofiler i ett svep — `data/library.json` med
 * omskrivna modellsökvägar och `public/models/*.glb` — så att vägen från
 * "uppladdat i admin" till "finns kvar efter omstart" är en nedladdning, en
 * uppackning och en commit.
 */
export async function GET() {
  if ((await currentRole()) !== "admin") {
    return NextResponse.json({ error: "Kräver adminbehörighet." }, { status: 403 });
  }

  const document = await readDocument();

  // Modellerna läses före planeringen: bara det som faktiskt finns kvar i
  // lagret får skrivas om till en sökväg i arkivet.
  const loaded = new Map<string, Buffer>();
  for (const id of referencedModelIds(document)) {
    const model = await readModel(id);
    if (model) loaded.set(id, model.data);
  }

  const plan = planDemoBundle(document, new Set(loaded.keys()));
  const now = new Date();

  const zip = await createZip(bundleEntries(plan, loaded, now), now);
  const summary = {
    models: plan.files.length,
    missing: plan.missing.length,
    machines: plan.document.machines.length,
    images: plan.images.length + plan.keptAssets,
    bytes: zip.length,
  };

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="${bundleFileName(now)}"`,
      // Admin-vyn läser sammanfattningen ur huvudet och slipper en extra runda.
      "X-Bundle-Summary": encodeURIComponent(JSON.stringify(summary)),
      "Cache-Control": "no-store",
    },
  });
}
