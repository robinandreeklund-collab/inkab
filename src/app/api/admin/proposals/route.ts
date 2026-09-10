import { NextResponse } from "next/server";
import { z } from "zod";
import { configurationSchema } from "@/lib/schema";
import { computeLayout } from "@/lib/layout";
import { quoteReference } from "@/lib/quote";
import { requireAdmin } from "@/lib/server/session";
import { activeContext } from "@/lib/server/context";
import { priceConfiguration } from "@/lib/server/pricing";
import {
  deleteAnyProposal,
  listAllProposals,
  readAnyProposal,
  saveProposal,
  updateProposalMeta,
} from "@/lib/server/store";
import type { Configuration } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Alla offerter, för INKAB.
 *
 * Kundens egen lista ligger kvar där den ligger och rör bara henne. Det här är
 * säljarens vy över affärerna: vem som håller på med vad, vad det ligger på och
 * var det står. Priserna räknas här som överallt annars — på servern, ur
 * prisboken, med offertens egen justering ovanpå.
 */

const patchSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120).optional(),
  /** Ändrad konfiguration, när offerten öppnats och byggts om. */
  config: configurationSchema.optional(),
  log: z.array(z.record(z.string(), z.unknown())).max(400).optional(),
  status: z.enum(["draft", "sent", "won", "lost"]).optional(),
  adjustment: z
    .object({
      discountPercent: z.number().finite().optional(),
      fixedTotalSek: z.number().finite().optional(),
      note: z.string().max(300).optional(),
    })
    .optional(),
});

export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }

  const { library, priceBook } = await activeContext();
  const id = new URL(request.url).searchParams.get("id");

  if (id) {
    const proposal = await readAnyProposal(id);
    if (!proposal) return NextResponse.json({ error: "Hittades inte." }, { status: 404 });
    return NextResponse.json({ proposal });
  }

  const proposals = await listAllProposals();
  const rows = proposals.map((proposal) => {
    const config = proposal.config as Configuration;
    const layout = computeLayout(config, library);
    const price = priceConfiguration(config, "admin", library, priceBook, proposal.adjustment);
    return {
      id: proposal.id,
      name: proposal.name,
      reference: proposal.reference || quoteReference(config),
      status: proposal.status,
      adjustment: proposal.adjustment,
      updatedAt: proposal.updatedAt,
      ownerEmail: proposal.ownerEmail ?? null,
      ownerName: proposal.ownerName ?? null,
      projectName: config.projectName,
      customer: config.customer ?? null,
      machineCount: config.line.length,
      totalLengthMm: layout.metrics.totalLengthMm,
      errorCount: layout.diagnostics.filter((d) => d.severity === "error").length,
      warningCount: layout.diagnostics.filter((d) => d.severity === "warning").length,
      listSek: price.adjustment?.listSek ?? price.totals?.grandTotal ?? 0,
      finalSek: price.totals?.grandTotal ?? 0,
      logCount: Array.isArray(proposal.log) ? proposal.log.length : 0,
    };
  });

  return NextResponse.json({ proposals: rows });
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltig ändring." }, { status: 400 });
  }

  const { id, config, log, ...patch } = parsed.data;
  if (config) {
    // Konfigurationen skrivs om via samma väg som allt annat: validerad, med
    // referensen räknad ur innehållet.
    const existing = await readAnyProposal(id);
    if (!existing) return NextResponse.json({ error: "Hittades inte." }, { status: 404 });
    await saveProposal({
      id,
      userId: existing.userId,
      name: patch.name?.trim() || existing.name,
      reference: quoteReference(config as Configuration),
      config,
      log: log ?? (existing.log as unknown[]),
    });
  }

  const updated = await updateProposalMeta(id, patch);
  if (!updated) return NextResponse.json({ error: "Hittades inte." }, { status: 404 });

  const { library, priceBook } = await activeContext();
  const price = priceConfiguration(
    updated.config as Configuration,
    "admin",
    library,
    priceBook,
    updated.adjustment,
  );

  return NextResponse.json({
    ok: true,
    proposal: {
      id: updated.id,
      name: updated.name,
      status: updated.status,
      adjustment: updated.adjustment,
      updatedAt: updated.updatedAt,
      listSek: price.adjustment?.listSek ?? price.totals?.grandTotal ?? 0,
      finalSek: price.totals?.grandTotal ?? 0,
    },
  });
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Kräver admin." }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Saknar id." }, { status: 400 });
  await deleteAnyProposal(id);
  return NextResponse.json({ ok: true });
}
