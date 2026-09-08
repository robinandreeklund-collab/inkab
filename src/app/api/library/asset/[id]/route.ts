import { readDocument } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serverar en maskinbild ur biblioteksdokumentet. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const document = await readDocument();
  const asset = document.assets?.find((a) => a.id === id);

  if (!asset) return new Response("Hittades inte", { status: 404 });

  return new Response(Buffer.from(asset.data, "base64"), {
    headers: {
      "Content-Type": asset.mime,
      // Bilden byts genom att få ett nytt id, så den kan cachas hårt.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
