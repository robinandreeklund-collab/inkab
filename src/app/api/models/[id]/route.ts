import { readModel } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serverar en uppladdad GLB. Ligger utanför /api/library med flit: modellerna
 * lagras för sig och hämtas bara när vyn Modell öppnas.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const model = await readModel(id);

  if (!model) return new Response("Hittades inte", { status: 404 });

  return new Response(new Uint8Array(model.data), {
    headers: {
      "Content-Type": "model/gltf-binary",
      "Content-Length": String(model.data.length),
      "Content-Disposition": `inline; filename="${model.meta.machineId}.glb"`,
      // En ny konvertering får ett nytt id, så filen kan cachas hårt.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
