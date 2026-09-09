import { NextResponse } from "next/server";
import { currentRole } from "@/lib/server/session";
import { deleteModel, listModels, putModel } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lagrar en färdig GLB.
 *
 * Servern konverterar inte längre. Tesselleringen körs i admin-vyns web
 * worker, där minnet finns, och hit kommer bara resultatet — några hundra
 * kilobyte i stället för åttio megabyte STEP. Rutten kan därför inte längre
 * fälla webbinstansen, och det finns ingen tidsgräns att slå i.
 */

/** En GLB som är större än så här hör inte hemma i en layoutvy. */
const MAX_GLB_BYTES = 40 * 1024 * 1024;

async function guard() {
  const role = await currentRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "Kräver adminbehörighet." }, { status: 403 });
  }
  return null;
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

  const machineId = String(form.get("machineId") ?? "").trim();
  const sourceName = String(form.get("sourceName") ?? "").slice(0, 160);
  const glb = form.get("glb");
  const proxy = form.get("proxy");

  if (!machineId) return NextResponse.json({ error: "Maskin-id saknas." }, { status: 400 });
  if (!(glb instanceof File) || glb.size === 0) {
    return NextResponse.json({ error: "Ingen modell bifogad." }, { status: 400 });
  }
  if (glb.size > MAX_GLB_BYTES) {
    return NextResponse.json(
      {
        error:
          `Modellen är ${(glb.size / 1024 / 1024).toFixed(0)} MB. Taket är ` +
          `${MAX_GLB_BYTES / 1024 / 1024} MB — höj toleransen eller gränsen för smådelar ` +
          "och konvertera om.",
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await glb.arrayBuffer());
  // glTF-binärt börjar alltid med "glTF". Kontrollen kostar inget och hindrar
  // att något annat än en modell hamnar i lagret.
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "glTF") {
    return NextResponse.json({ error: "Filen är inte en GLB." }, { status: 400 });
  }

  const base = `${machineId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const notes: string[] = [];

  const stored = await putModel({
    id: base,
    machineId,
    name: sourceName || `${machineId}.step`,
    kind: "glb",
    data: bytes,
  });
  if (!stored.persisted) {
    notes.push(
      `Modellen ligger bara i serverns minne (${stored.reason}) och försvinner vid omstart. ` +
        "Sätt DATABASE_URL för att spara den.",
    );
  }

  let proxyUrl: string | undefined;
  if (proxy instanceof File && proxy.size > 0 && proxy.size <= MAX_GLB_BYTES) {
    await putModel({
      id: `${base}-proxy`,
      machineId,
      name: sourceName || `${machineId}.step`,
      kind: "proxy",
      data: new Uint8Array(await proxy.arrayBuffer()),
    });
    proxyUrl = `/api/models/${base}-proxy`;
  }

  return NextResponse.json({
    ok: true,
    model: { glb: `/api/models/${base}`, proxy: proxyUrl },
    persisted: stored.persisted,
    notes,
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
