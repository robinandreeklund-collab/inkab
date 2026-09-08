import { NextResponse } from "next/server";
import { z } from "zod";
import { collectIssues, libraryDocumentSchema } from "@/lib/machineSchema";
import { computeLayout } from "@/lib/layout";
import { makeLibrary } from "@/lib/library";
import { readDocument, resetDocument, storeStatus, writeDocument } from "@/lib/server/store";
import { currentRole } from "@/lib/server/session";
import { templateConfig } from "@/lib/templates";
import type { LibraryDocument } from "@/lib/machineSchema";
import type { Machine } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  const role = await currentRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "Kräver adminbehörighet." }, { status: 403 });
  }
  return null;
}

/** Hämtar hela dokumentet: maskiner, prisbok och lagringsstatus. */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const [document, status] = await Promise.all([readDocument(), storeStatus()]);
  return NextResponse.json({ document, status });
}

const putSchema = z.object({ document: libraryDocumentSchema });

/** Sparar hela dokumentet. Validerar och provkör motorn innan det accepteras. */
export async function PUT(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ogiltig maskindata.", issues: collectIssues(parsed.error) },
      { status: 400 },
    );
  }

  const document = parsed.data.document as LibraryDocument;

  // Provkörning: ett bibliotek som får motorn att kasta får inte sparas.
  try {
    const library = makeLibrary(document.machines as Machine[]);
    computeLayout(templateConfig("strolinje"), library);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Biblioteket får layoutmotorn att haverera och sparades inte.",
        issues: [
          { path: "machines", message: error instanceof Error ? error.message : "Okänt fel." },
        ],
      },
      { status: 400 },
    );
  }

  const result = await writeDocument(document, "admin");
  const status = await storeStatus();
  return NextResponse.json({ ok: true, persisted: result.persisted, reason: result.reason, status });
}

/** Återställer till det versionshanterade utgångsläget. */
export async function DELETE() {
  const denied = await guard();
  if (denied) return denied;

  const document = await resetDocument("admin");
  const status = await storeStatus();
  return NextResponse.json({ ok: true, document, status });
}
