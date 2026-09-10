import { requireAdmin } from "@/lib/server/session";
import { readDocumentFile } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hämtar en fil ur maskinens underlag.
 *
 * Bara för INKAB. Balklistor och skärfiler är tillverkningsunderlag, inte
 * kundmaterial — det är skillnad på att visa vad en maskin är och att lämna ut
 * hur den byggs.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return new Response("Kräver admin", { status: 403 });

  const { id } = await context.params;
  const found = await readDocumentFile(id);
  if (!found) return new Response("Hittades inte", { status: 404 });

  return new Response(new Uint8Array(found.data), {
    headers: {
      "Content-Type": found.meta.mime || "application/octet-stream",
      // Filnamnet följer med så att den som laddar ner får rätt namn i mappen.
      "Content-Disposition": `attachment; filename="${encodeURIComponent(found.meta.name)}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
