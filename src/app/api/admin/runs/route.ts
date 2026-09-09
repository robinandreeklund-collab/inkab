import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { listRecentDraftJobs } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * De senaste assistentkörningarna, för admin.
 *
 * Frågan "varför tog det sex minuter" besvaras av rundorna: modellens egen tid
 * mot verktygens, och vad varje runda kostade i token. Konfigurationerna följer
 * inte med — de är stora och säger inget om tiden.
 */
export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }

  const limit = Math.min(
    50,
    Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 20)),
  );
  const jobs = (await listRecentDraftJobs(limit)).map((job) => ({
    id: job.id,
    status: job.status,
    step: job.step,
    note: job.note,
    fileNames: job.fileNames,
    summary: job.summary,
    error: job.error,
    variantCount: job.variants.length,
    detail: job.detail,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }));

  return NextResponse.json({ jobs });
}
