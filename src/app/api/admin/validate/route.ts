import { NextResponse } from "next/server";
import { z } from "zod";
import { collectIssues, machineSchema } from "@/lib/machineSchema";
import { computeLayout } from "@/lib/layout";
import { makeLibrary } from "@/lib/library";
import { readDocument } from "@/lib/server/store";
import { currentRole } from "@/lib/server/session";
import { DEFAULT_FLOW, DEFAULT_HALL, DEFAULT_PRODUCT } from "@/lib/templates";
import type { Configuration, Machine } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ machine: machineSchema });

/**
 * Provkopplar en maskin i en tvåstegskedja och rapporterar om portarna
 * faktiskt går att koppla in. Fångar den vanligaste datafelet — en port med
 * fel riktning eller fel höjd — innan maskinen når kunden.
 */
export async function POST(request: Request) {
  if ((await currentRole()) !== "admin") {
    return NextResponse.json({ error: "Kräver adminbehörighet." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, issues: collectIssues(parsed.error) },
      { status: 200 },
    );
  }

  const machine = parsed.data as unknown as { machine: Machine };
  const candidate = machine.machine;

  if (candidate.aux) {
    return NextResponse.json({
      ok: true,
      issues: [],
      note: "Hjälpobjekt kopplas inte in i kedjan och provkörs därför inte.",
    });
  }

  const document = await readDocument();
  const feeder = (document.machines as Machine[]).find(
    (m) => !m.aux && m.id !== candidate.id && m.ports.some((p) => p.role === "out"),
  );

  const machines: Machine[] = [candidate, ...(feeder ? [feeder] : [])];
  const library = makeLibrary(machines);

  const config: Configuration = {
    version: 1,
    projectName: "Provkoppling",
    hall: { lengthMm: 200_000, widthMm: 120_000, clearHeightMm: 40_000 },
    flow: { ...DEFAULT_FLOW },
    product: { ...DEFAULT_PRODUCT },
    line: [
      ...(feeder
        ? [{ instanceId: "feeder", machineId: feeder.id, selectedOptions: [] }]
        : []),
      { instanceId: "candidate", machineId: candidate.id, selectedOptions: [] },
    ],
    drawn: [],
  };

  const layout = computeLayout(config, library);
  const placed = layout.placements.find((p) => p.instanceId === "candidate");

  const issues = layout.diagnostics
    .filter((d) => d.severity === "error" && d.instanceIds.includes("candidate"))
    .map((d) => ({ path: d.code, message: d.detail }));

  return NextResponse.json({
    ok: !!placed && issues.length === 0,
    issues,
    placed: placed
      ? {
          rotation: placed.rotation,
          mirrored: placed.mirrored,
          lengthMm: placed.size.lengthMm,
          widthMm: placed.size.widthMm,
        }
      : null,
    note: feeder
      ? `Provkopplad efter ${feeder.name}.`
      : "Inget annat maskin att koppla efter — endast maskinen själv provkördes.",
  });
}
