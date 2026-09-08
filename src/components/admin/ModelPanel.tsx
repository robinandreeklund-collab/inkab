"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tag } from "../ui";
import { Grid, NumField, Panel, SelectField, TextField } from "./fields";
import type { Machine, Port } from "@/lib/types";

/**
 * STEP-uppladdning per maskin.
 *
 * Admin väljer maskinens STEP-fil; servern tessellerar, komprimerar och
 * lagrar GLB:n och svarar med vad geometrin säger. Måtten skrivs aldrig in
 * automatiskt — panelen visar skillnaden mot biblioteket och admin bestämmer.
 * Ett uppmätt värde är sanning tills någon medvetet byter ut det.
 */

type Stats = {
  stepBytes: number;
  glbBytes: number;
  proxyBytes: number | null;
  partsIn: number;
  partsKept: number;
  trianglesIn: number;
  toleranceMm: number;
  minPartMm: number;
  seconds: number;
};

type Result = {
  model: { glb: string; proxy?: string };
  footprint: { lengthMm: number; widthMm: number; heightMm: number };
  ports: Port[];
  warnings: string[];
  notes: string[];
  persisted: boolean;
  stats: Stats;
};

type StoredModel = {
  id: string;
  machineId: string;
  name: string;
  kind: "glb" | "proxy";
  bytes: number;
  createdAt: string;
};

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
const meters = (mm: number) => `${(mm / 1000).toFixed(2).replace(".", ",")} m`;

export function ModelPanel({
  machine,
  onChange,
}: {
  machine: Machine;
  onChange: (machine: Machine) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [tolerance, setTolerance] = useState(2);
  const [minPart, setMinPart] = useState(50);
  const [up, setUp] = useState<"z" | "y">("z");
  const [proxy, setProxy] = useState(true);

  const [phase, setPhase] = useState<"idle" | "sending" | "converting">("idle");
  const [percent, setPercent] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [stored, setStored] = useState<StoredModel[]>([]);

  const busy = phase !== "idle";

  const loadStored = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/step?machineId=${encodeURIComponent(machine.id)}`);
      if (!response.ok) return;
      const body = (await response.json()) as { models: StoredModel[] };
      setStored(body.models.filter((m) => m.kind === "glb"));
    } catch {
      // Listan är en bekvämlighet; misslyckas den ska panelen ändå fungera.
    }
  }, [machine.id]);

  useEffect(() => {
    setResult(null);
    setError(null);
    loadStored();
  }, [loadStored]);

  // Tesselleringen kan ta minuter på en stor sammanställning. Utan en klocka
  // ser det ut som att det har hängt sig.
  useEffect(() => {
    if (phase !== "converting") return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const upload = (file: File) => {
    setError(null);
    setResult(null);
    setPercent(0);
    setPhase("sending");

    const form = new FormData();
    form.set("file", file);
    form.set("machineId", machine.id);
    form.set("tolerance", String(tolerance));
    form.set("minPart", String(minPart));
    form.set("up", up);
    form.set("proxy", String(proxy));

    // XHR i stället för fetch: en 80 MB STEP behöver en förloppsindikator,
    // och fetch rapporterar inte hur mycket av kroppen som har gått iväg.
    const request = new XMLHttpRequest();
    request.open("POST", "/api/admin/step");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setPercent(Math.round((event.loaded / event.total) * 100));
    };
    request.upload.onload = () => setPhase("converting");
    request.onerror = () => {
      setPhase("idle");
      setError("Uppladdningen bröts. Nätverket eller servern svarade inte.");
    };
    request.onload = () => {
      setPhase("idle");
      let body: (Result & { error?: string }) | null = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        setError(`Servern svarade ${request.status} utan läsbart innehåll.`);
        return;
      }
      if (request.status >= 400 || !body) {
        setError(body?.error ?? `Servern svarade ${request.status}.`);
        return;
      }
      setResult(body);
      onChange({ ...machine, model: { glb: body.model.glb, proxy: body.model.proxy } });
      loadStored();
    };
    request.send(form);
  };

  const applyFootprint = () => {
    if (!result) return;
    onChange({
      ...machine,
      footprint: result.footprint,
      // Måtten kommer nu ur geometrin, men portlägen och nollpunkt är
      // fortfarande gissningar tills en konstruktör har sett dem.
      dimensionsVerified: false,
    });
  };

  const applyPorts = () => {
    if (!result || machine.aux) return;
    onChange({ ...machine, ports: result.ports, dimensionsVerified: false });
  };

  const removeStored = async (id: string) => {
    await fetch(`/api/admin/step?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (machine.model?.glb === `/api/models/${id}`) {
      onChange({ ...machine, model: undefined });
    }
    loadStored();
  };

  const diff = result
    ? ([
        ["Längd", machine.footprint.lengthMm, result.footprint.lengthMm],
        ["Bredd", machine.footprint.widthMm, result.footprint.widthMm],
        ["Höjd", machine.footprint.heightMm, result.footprint.heightMm],
      ] as const)
    : [];
  const differs = diff.some(([, before, after]) => Math.abs(before - after) > 10);

  return (
    <Panel
      title="3D-modell från STEP"
      description="Ladda upp maskinens STEP-fil. Servern tessellerar och komprimerar."
      action={
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".step,.stp,.STEP,.STP"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
            {phase === "sending"
              ? `Laddar upp ${percent} %`
              : phase === "converting"
                ? `Konverterar… ${elapsed} s`
                : "+ STEP-fil"}
          </Button>
        </div>
      }
    >
      {phase === "sending" ? (
        <div className="mb-3 h-1 w-full bg-paper">
          <div className="h-1 bg-accent transition-all" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {phase === "converting" ? (
        <p className="mb-3 border border-divider bg-paper px-3 py-2 text-xs text-muted">
          Filen är uppe. Tesselleringen körs på servern och tar sekunder till minuter
          beroende på hur mycket geometri sammanställningen innehåller. Lämna fliken öppen.
        </p>
      ) : null}

      {error ? (
        <p className="mb-3 border border-danger px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      <Grid cols={4}>
        <NumField
          label="Tolerans"
          unit="mm"
          hint="mm — störst effekt"
          step={0.1}
          value={tolerance}
          onChange={setTolerance}
        />
        <NumField
          label="Minsta del"
          unit="mm"
          hint="mm — utelämnar skruv"
          value={minPart}
          onChange={setMinPart}
        />
        <SelectField
          label="Upp-axel i filen"
          value={up}
          options={[
            { value: "z", label: "Z upp (SolidWorks, Inventor)" },
            { value: "y", label: "Y upp" },
          ]}
          onChange={setUp}
        />
        <SelectField
          label="Proxy"
          value={proxy ? "ja" : "nej"}
          hint="förenklad översiktsmodell"
          options={[
            { value: "ja", label: "Skriv proxy" },
            { value: "nej", label: "Bara full modell" },
          ]}
          onChange={(v) => setProxy(v === "ja")}
        />
      </Grid>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Toleransen är den största spaken: 5 mm mot 0,1 mm är ofta 15–35 gånger färre
        trianglar på krökt geometri och visuellt identiskt i layoutskala. Går det inte
        att konvertera här — filen är för stor eller minnet tar slut — kör{" "}
        <code className="num">node scripts/step-to-glb.mjs fil.step --id {machine.id}</code>{" "}
        lokalt och lägg GLB:n under <code className="num">public/models</code>.
      </p>

      {result ? (
        <div className="mt-3 border border-divider">
          <div className="flex flex-wrap items-center gap-2 border-b border-divider bg-paper px-3 py-2">
            <span className="kicker">Resultat</span>
            <Tag tone="accent">{mb(result.stats.stepBytes)} → {mb(result.stats.glbBytes)}</Tag>
            <Tag>{result.stats.seconds.toFixed(1).replace(".", ",")} s</Tag>
            <Tag>
              {result.stats.partsKept} av {result.stats.partsIn} delar
            </Tag>
            <Tag>{result.stats.trianglesIn.toLocaleString("sv-SE")} trianglar</Tag>
            {result.persisted ? null : <Tag tone="warn">bara i minnet</Tag>}
          </div>

          <div className="p-3">
            {result.warnings.map((warning) => (
              <p key={warning} className="mb-2 border border-warn px-2 py-1 text-xs text-warn">
                {warning}
              </p>
            ))}
            {result.notes.map((note) => (
              <p key={note} className="mb-2 text-xs text-muted">
                {note}
              </p>
            ))}

            <table className="mb-3 w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 font-normal">Mått</th>
                  <th className="py-1 font-normal">I biblioteket</th>
                  <th className="py-1 font-normal">Ur modellen</th>
                </tr>
              </thead>
              <tbody>
                {diff.map(([label, before, after]) => (
                  <tr key={label} className="border-t border-divider">
                    <td className="py-1">{label}</td>
                    <td className="num py-1">{meters(before)}</td>
                    <td
                      className={
                        Math.abs(before - after) > 10 ? "num py-1 text-danger" : "num py-1"
                      }
                    >
                      {meters(after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={differs ? "primary" : "ghost"} onClick={applyFootprint}>
                Använd modellens mått
              </Button>
              {machine.aux ? null : (
                <Button size="sm" variant="ghost" onClick={applyPorts}>
                  Använd portförslaget
                </Button>
              )}
              <a
                href={result.model.glb}
                className="border border-divider px-2 py-1 text-xs text-muted hover:text-ink"
              >
                Hämta GLB
              </a>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Portförslaget lägger in- och utport mitt på kortsidorna. Det är en gissning ur
              fotavtrycket, inte ur geometrin — kontrollera lägena mot ritning innan maskinen
              visas för kund.
            </p>
          </div>
        </div>
      ) : null}

      {stored.length > 0 ? (
        <div className="mt-3 border-t border-divider pt-3">
          <div className="kicker mb-1">Lagrade modeller</div>
          <ul className="text-xs">
            {stored.map((model) => {
              const url = `/api/models/${model.id}`;
              const active = machine.model?.glb === url;
              return (
                <li key={model.id} className="flex items-center gap-2 border-t border-divider py-1">
                  <span className="truncate">{model.name}</span>
                  <span className="num text-muted">{mb(model.bytes)}</span>
                  <span className="text-muted">
                    {new Date(model.createdAt).toLocaleDateString("sv-SE")}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {active ? (
                      <Tag tone="accent">används</Tag>
                    ) : (
                      <button
                        className="text-muted hover:text-ink"
                        onClick={() => onChange({ ...machine, model: { glb: url } })}
                      >
                        Använd
                      </button>
                    )}
                    <button
                      className="text-muted hover:text-danger"
                      onClick={() => removeStored(model.id)}
                      aria-label="Ta bort modell"
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 border-t border-divider pt-3">
        <p className="mb-2 text-[11px] text-muted">
          Sökvägarna går att skriva för hand om modellen ligger under{" "}
          <code className="num">public/models</code>.
        </p>
        <Grid cols={2}>
          <TextField
            label="GLB"
            mono
            value={machine.model?.glb ?? ""}
            placeholder="/models/tsl-enkel.glb"
            onChange={(v) =>
              onChange({
                ...machine,
                model: v ? { glb: v, proxy: machine.model?.proxy } : undefined,
              })
            }
          />
          <TextField
            label="Proxy-GLB"
            mono
            hint="valfri"
            value={machine.model?.proxy ?? ""}
            placeholder="/models/tsl-enkel.proxy.glb"
            onChange={(v) =>
              onChange({
                ...machine,
                model: machine.model?.glb
                  ? { glb: machine.model.glb, proxy: v || undefined }
                  : machine.model,
              })
            }
          />
        </Grid>
      </div>
    </Panel>
  );
}
