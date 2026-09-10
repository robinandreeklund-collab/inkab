import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { currentUser } from "@/lib/server/session";
import {
  deleteDocument,
  listDocuments,
  putDocument,
  updateDocumentMeta,
} from "@/lib/server/store";
import {
  guessKind,
  isDocumentKind,
  isOrderState,
  MAX_DOCUMENT_BYTES,
  type DocumentKind,
  type OrderState,
} from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Maskinernas underlag: ritningar, STEP, balklistor, skärfiler.
 *
 * Filerna skickas som formulärdata och inte som base64 i JSON — en STEP-fil på
 * tre megabyte blir fyra som text, och det är fyra megabyte att skicka och
 * tolka i onödan.
 */

const patchSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.string().max(20).optional(),
  title: z.string().max(200).optional(),
  revision: z.string().max(40).optional(),
  note: z.string().max(600).optional(),
  orderState: z.string().max(20).optional(),
  supplier: z.string().max(160).optional(),
});

export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }
  const machineId = new URL(request.url).searchParams.get("machineId") ?? undefined;
  return NextResponse.json({ documents: await listDocuments(machineId) });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const machineId = String(form?.get("machineId") ?? "").trim();

  if (!form || !(file instanceof File) || !machineId) {
    return NextResponse.json({ error: "Saknar fil eller maskin." }, { status: 400 });
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json(
      {
        error:
          `Filen är ${(file.size / 1e6).toFixed(1)} MB. Taket är ` +
          `${MAX_DOCUMENT_BYTES / 1e6} MB — lägg stora underlag i en delad mapp och ` +
          "länka till dem i noteringen i stället.",
      },
      { status: 413 },
    );
  }

  const kindRaw = String(form.get("kind") ?? "");
  const kind: DocumentKind = isDocumentKind(kindRaw) ? kindRaw : guessKind(file.name);
  const orderRaw = String(form.get("orderState") ?? "");
  const orderState: OrderState = isOrderState(orderRaw) ? orderRaw : "none";
  const user = await currentUser();

  const result = await putDocument({
    meta: {
      id: `doc-${randomBytes(12).toString("hex")}`,
      machineId,
      kind,
      name: file.name.slice(0, 200),
      title: String(form.get("title") ?? "").slice(0, 200),
      mime: file.type || "application/octet-stream",
      revision: String(form.get("revision") ?? "").slice(0, 40),
      note: String(form.get("note") ?? "").slice(0, 600),
      orderState,
      supplier: String(form.get("supplier") ?? "").slice(0, 160),
      uploadedBy: user?.email ?? "",
    },
    data: new Uint8Array(await file.arrayBuffer()),
  });

  return NextResponse.json({
    ok: true,
    document: result.meta,
    persisted: result.persisted,
    reason: result.reason,
  });
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig ändring." }, { status: 400 });

  const { id, kind, orderState, ...rest } = parsed.data;
  const updated = await updateDocumentMeta(id, {
    ...rest,
    ...(kind && isDocumentKind(kind) ? { kind } : {}),
    ...(orderState && isOrderState(orderState) ? { orderState } : {}),
  });
  if (!updated) return NextResponse.json({ error: "Hittades inte." }, { status: 404 });
  return NextResponse.json({ ok: true, document: updated });
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Saknar id." }, { status: 400 });
  await deleteDocument(id);
  return NextResponse.json({ ok: true });
}
