import { NextResponse } from "next/server";
import { convertStep } from "@/lib/server/stepConvert";
import { currentRole } from "@/lib/server/session";
import { deleteModel, listModels, putModel } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Tessellering av en stor sammanställning tar minuter, inte sekunder. */
export const maxDuration = 300;

/**
 * STEP in, GLB ut — utan att någon behöver köra ett skript.
 *
 * Admin laddar upp maskinens STEP-fil direkt i maskinformuläret. Servern
 * tessellerar, komprimerar, lagrar GLB:n och svarar med fotavtryck,
 * portförslag och mätvärden. Måtten skrivs INTE in i maskinen här: svaret
 * visar skillnaden mot biblioteket och admin får bestämma.
 */

/** Tak för uppladdningen. Större filer körs med scripts/step-to-glb.mjs. */
const MAX_STEP_BYTES = 120 * 1024 * 1024;

async function guard() {
  const role = await currentRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "Kräver adminbehörighet." }, { status: 403 });
  }
  return null;
}

function number(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Kunde inte läsa uppladdningen." }, { status: 400 });
  }

  const file = form.get("file");
  const machineId = String(form.get("machineId") ?? "").trim();

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Ingen fil bifogad." }, { status: 400 });
  }
  if (!machineId) {
    return NextResponse.json({ error: "Maskin-id saknas." }, { status: 400 });
  }
  if (file.size > MAX_STEP_BYTES) {
    return NextResponse.json(
      {
        error:
          `Filen är ${(file.size / 1024 / 1024).toFixed(0)} MB. Taket är ` +
          `${MAX_STEP_BYTES / 1024 / 1024} MB — kör större filer med ` +
          "scripts/step-to-glb.mjs lokalt och lägg GLB:n under public/models.",
      },
      { status: 413 },
    );
  }
  if (!/\.(stp|step|STP|STEP)$/.test(file.name)) {
    return NextResponse.json(
      { error: "Filen måste vara en STEP (.step eller .stp)." },
      { status: 400 },
    );
  }

  const options = {
    toleranceMm: number(form.get("tolerance"), 2, 0.01, 50),
    angularDeflection: number(form.get("angular"), 0.5, 0.05, 2),
    minPartMm: number(form.get("minPart"), 50, 0, 2000),
    ratio: number(form.get("ratio"), 1, 0.01, 1),
    up: form.get("up") === "y" ? ("y" as const) : ("z" as const),
    proxy: form.get("proxy") === "true",
  };

  const step = new Uint8Array(await file.arrayBuffer());

  let result;
  try {
    result = await convertStep(step, options);
  } catch (error) {
    // Konverteringen är det som kan gå sönder på riktigt: trasig STEP, slut
    // på minne, geometri som inte går att tessellera. Säg vad som hände.
    const message = error instanceof Error ? error.message : "Okänt fel.";
    const outOfMemory = /memory|allocat|heap/i.test(message);
    return NextResponse.json(
      {
        error: outOfMemory
          ? "Servern fick slut på minne under tesselleringen. Höj toleransen och " +
            "gränsen för smådelar, eller kör filen med scripts/step-to-glb.mjs lokalt."
          : `Konverteringen misslyckades: ${message}`,
      },
      { status: 422 },
    );
  }

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base = `${machineId}-${stamp}`;
  const notes: string[] = [];

  const stored = await putModel({
    id: base,
    machineId,
    name: file.name.slice(0, 160),
    kind: "glb",
    data: result.glb,
  });
  if (!stored.persisted) {
    notes.push(
      `Modellen ligger bara i serverns minne (${stored.reason}) och försvinner vid omstart. ` +
        "Sätt DATABASE_URL för att spara den.",
    );
  }

  // En proxy som inte är märkbart mindre är bara en fil till att ladda ner.
  // Det händer på lätt geometri, där det inte finns något att förenkla bort.
  let proxyUrl: string | undefined;
  if (result.proxy && result.proxy.length < result.glb.length * 0.6) {
    await putModel({
      id: `${base}-proxy`,
      machineId,
      name: file.name.slice(0, 160),
      kind: "proxy",
      data: result.proxy,
    });
    proxyUrl = `/api/models/${base}-proxy`;
  } else if (result.proxy) {
    notes.push(
      "Proxyn blev inte mindre än modellen och sparades inte — geometrin är redan lätt.",
    );
  }

  return NextResponse.json({
    ok: true,
    model: { glb: `/api/models/${base}`, proxy: proxyUrl },
    footprint: result.footprint,
    ports: result.ports,
    warnings: result.warnings,
    notes,
    persisted: stored.persisted,
    stats: result.stats,
  });
}

/** Modellerna som ligger lagrade, för en maskin eller alla. */
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const machineId = new URL(request.url).searchParams.get("machineId") ?? undefined;
  return NextResponse.json({ models: await listModels(machineId) });
}

export async function DELETE(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Id saknas." }, { status: 400 });

  await deleteModel(id);
  await deleteModel(`${id}-proxy`);
  return NextResponse.json({ ok: true });
}
