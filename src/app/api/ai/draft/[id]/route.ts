import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { deleteDraftJob, readDraftJob } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Läget för ett jobb. Id:t är nyckeln; ett jobb med konto kräver kontot. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const job = await readDraftJob(id, user?.id ?? null);
  if (!job) return NextResponse.json({ error: "Hittades inte." }, { status: 404 });
  return NextResponse.json({ job });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  await deleteDraftJob(id, user?.id ?? null);
  return NextResponse.json({ ok: true });
}
