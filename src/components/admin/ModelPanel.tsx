"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tag } from "../ui";
import { Grid, NumField, Panel, SelectField, TextField } from "./fields";
import { collectIssues, machineSchema } from "@/lib/machineSchema";
import { applyModelFootprint, applySuggestedPorts } from "@/lib/cad/applyModel";
import {
  bestOrientation,
  orientationLabel,
  orientedFootprint,
  YAW_STEPS,
  type ModelOrientation,
} from "@/lib/cad/orientation";
import { ModelPreview } from "./ModelPreview";
import type { WorkerRequest, WorkerResponse } from "@/workers/step.worker";
import type { Machine, Port } from "@/lib/types";

/**
 * STEP-konvertering per maskin.
 *
 * Konverteringen körs i webbläsaren, i en web worker, på den här datorn.
 * STEP-filen laddas aldrig upp — bara den färdiga GLB:n, några hundra
 * kilobyte. Skälet är hårt: tesselleringen tar hundratals megabyte, och en
 * webbinstans som får slut på minne dör utan att kunna svara. Laptopen har
 * minnet; webbservern har det inte.
 *
 * Måtten skrivs aldrig in automatiskt — panelen visar skillnaden mot
 * biblioteket och admin bestämmer. Ett uppmätt värde är sanning tills någon
 * medvetet byter ut det.
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

/**
 * Reservriktning när måtten inte kan avgöra saken — en nästan kvadratisk
 * maskin, eller ett fotavtryck i biblioteket som inte liknar något. INKAB:s
 * CAD ritar Y upp, så det är den bästa gissningen när gissa är allt som
 * återstår.
 */
const FALLBACK_UP_AXIS = "y" as const;

const STAGE_TEXT: Record<string, string> = {
  laddar: "Startar OpenCascade",
  tessellerar: "Tessellerar geometrin",
  rensar: "Utelämnar smådelar",
  bygger: "Bygger modellen",
  förenklar: "Förenklar proxyn",
  komprimerar: "Komprimerar",
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
  const [proxy, setProxy] = useState(true);

  const [stage, setStage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [stored, setStored] = useState<StoredModel[]>([]);
  const [applyIssues, setApplyIssues] = useState<string[]>([]);
  const [applyNote, setApplyNote] = useState<string | null>(null);
  /** Riktningen verktyget räknade fram vid konverteringen, om någon. */
  const [autoFit, setAutoFit] = useState<import("@/lib/cad/orientation").OrientationFit | null>(
    null,
  );

  const busy = stage !== null;

  const loadStored = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/model?machineId=${encodeURIComponent(machine.id)}`);
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
    setApplyIssues([]);
    setApplyNote(null);
    setAutoFit(null);
    loadStored();
  }, [loadStored]);

  // Tesselleringen kan ta minuter på en stor sammanställning. Utan en klocka
  // ser det ut som att det har hängt sig.
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const convert = async (file: File) => {
    setError(null);
    setResult(null);
    setStage("laddar");

    let worker: Worker;
    try {
      worker = new Worker(new URL("../../workers/step.worker.ts", import.meta.url));
    } catch {
      setStage(null);
      setError("Webbläsaren kunde inte starta konverteringen. Prova en nyare webbläsare.");
      return;
    }

    const step = await file.arrayBuffer();
    const started = Date.now();

    worker.onerror = (event) => {
      setStage(null);
      worker.terminate();
      // Slut på minne i webbläsaren visar sig här. Storleken är oftast svaret.
      setError(
        `Konverteringen avbröts (${event.message || "okänt fel"}). Är filen mycket stor: ` +
          "höj toleransen och gränsen för smådelar, eller kör den med skriptet.",
      );
    };

    worker.onmessage = async (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      if (message.kind === "progress") {
        setStage(message.stage);
        return;
      }

      if (message.kind === "error") {
        setStage(null);
        worker.terminate();
        setError(message.message);
        return;
      }

      worker.terminate();
      setStage("laddar upp");

      const stats = message.stats as Stats;
      const form = new FormData();
      form.set("machineId", machine.id);
      form.set("sourceName", file.name.slice(0, 160));
      form.set("glb", new Blob([message.glb], { type: "model/gltf-binary" }), `${machine.id}.glb`);
      // En proxy som inte är märkbart mindre är bara en fil till att ladda ner.
      if (message.proxy && message.proxy.byteLength < message.glb.byteLength * 0.6) {
        form.set(
          "proxy",
          new Blob([message.proxy], { type: "model/gltf-binary" }),
          `${machine.id}.proxy.glb`,
        );
      }

      try {
        const response = await fetch("/api/admin/model", { method: "POST", body: form });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) {
          setError(body?.error ?? `Servern svarade ${response.status}.`);
          setStage(null);
          return;
        }

        setResult({
          model: body.model,
          footprint: message.footprint,
          ports: message.ports as Port[],
          warnings: message.warnings,
          notes: body.notes ?? [],
          persisted: body.persisted,
          stats: { ...stats, seconds: Math.round((Date.now() - started) / 100) / 10 },
        });
        /*
         * Riktningen räknas ut ur måtten i stället för att gissas ur en
         * konvention. Alla fyra lägen provas mot maskinens fotavtryck, och
         * det som ger rätt form vinner — även när bibliotekets mått bara är
         * en uppskattning, eftersom jämförelsen görs på proportioner.
         * Skiljer inte formen lägena åt lämnas det åt ögat.
         */
        const fit = bestOrientation(message.footprint, machine.footprint);
        const auto = fit.confident
          ? fit.orientation
          : { upAxis: FALLBACK_UP_AXIS, yawDeg: 0 as const };

        onChange({
          ...machine,
          model: {
            glb: body.model.glb,
            proxy: body.model.proxy,
            // En riktning som redan är inställd för hand står över: har någon
            // vridit maskinen rätt ska en ny konvertering inte slå bort det.
            upAxis: machine.model?.upAxis ?? auto.upAxis,
            yawDeg: machine.model?.yawDeg ?? auto.yawDeg,
            flipped: machine.model?.flipped,
          },
        });
        setAutoFit(machine.model?.upAxis ? null : fit);
        loadStored();
      } catch {
        setError("Modellen konverterades men kunde inte sparas. Nätverket svarade inte.");
      } finally {
        setStage(null);
      }
    };

    worker.postMessage(
      {
        step,
        options: {
          toleranceMm: tolerance,
          angularDeflection: 0.5,
          minPartMm: minPart,
          ratio: 1,
          up: "z",
          proxy,
        },
      } satisfies WorkerRequest,
      [step],
    );
  };

  /**
   * Byter maskin bara om resultatet går att spara.
   *
   * Fotavtryck och portar hänger ihop: en port måste ligga innanför
   * maskinen. Att bara skriva in nya mått lämnade portarna kvar där de var,
   * och maskinen blev osparbar — knappen Spara gjorde ingenting och sa inte
   * varför. Kandidaten valideras därför mot samma schema som servern innan
   * den släpps in, och avvisas den står felen här i stället.
   */
  const apply = (candidate: Machine, applied: string) => {
    const parsed = machineSchema.safeParse(candidate);
    if (!parsed.success) {
      setApplyIssues(collectIssues(parsed.error).map((i) => `${i.path}: ${i.message}`));
      setApplyNote(null);
      return;
    }
    setApplyIssues([]);
    setApplyNote(applied);
    onChange(candidate);
  };

  const applyFootprint = () => {
    if (!result) return;
    const { machine: candidate, movedPorts } = applyModelFootprint(
      machine,
      orientedFootprint(result.footprint, orientation),
    );
    apply(
      candidate,
      movedPorts.length > 0
        ? `Måtten är satta ur modellen. ${movedPorts.length === 1 ? "Porten" : "Portarna"} ` +
            `${movedPorts.join(", ")} låg utanför och flyttades till kanten — kontrollera ` +
            `${movedPorts.length === 1 ? "läget" : "lägena"}.`
        : "Måtten är satta ur modellen.",
    );
  };

  const applyPorts = () => {
    if (machine.aux) return;
    apply(
      applySuggestedPorts(machine),
      "In- och utport är satta mitt på kortsidorna. Kontrollera lägena mot ritning.",
    );
  };

  const removeStored = async (id: string) => {
    await fetch(`/api/admin/model?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (machine.model?.glb === `/api/models/${id}`) {
      onChange({ ...machine, model: undefined });
    }
    loadStored();
  };

  const orientation: ModelOrientation = {
    upAxis: machine.model?.upAxis,
    yawDeg: machine.model?.yawDeg,
    flipped: machine.model?.flipped,
  };

  const setOrientation = (patch: ModelOrientation) => {
    if (!machine.model) return;
    onChange({ ...machine, model: { ...machine.model, ...patch } });
  };

  // Måtten som jämförs är de modellen får efter vridningen — reser man en
  // liggande modell byter bredd och höjd plats, och då är det de nya måtten
  // som ska ställas mot bibliotekets.
  const measured = result ? orientedFootprint(result.footprint, orientation) : null;

  const diff = measured
    ? ([
        ["Längd", machine.footprint.lengthMm, measured.lengthMm],
        ["Bredd", machine.footprint.widthMm, measured.widthMm],
        ["Höjd", machine.footprint.heightMm, measured.heightMm],
      ] as const)
    : [];
  const differs = diff.some(([, before, after]) => Math.abs(before - after) > 10);

  return (
    <Panel
      title="3D-modell från STEP"
      description="Välj maskinens STEP-fil. Den konverteras här i webbläsaren."
      action={
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".step,.stp,.STEP,.STP"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) convert(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? `${STAGE_TEXT[stage] ?? "Sparar"}… ${elapsed} s` : "+ STEP-fil"}
          </Button>
        </div>
      }
    >
      {busy ? (
        <p className="mb-3 border border-divider bg-paper px-3 py-2 text-xs text-muted">
          {STAGE_TEXT[stage] ?? "Sparar modellen"}. Konverteringen körs på den här datorn
          och tar sekunder till minuter beroende på hur mycket geometri sammanställningen
          innehåller. Lämna fliken öppen — gränssnittet fungerar under tiden.
        </p>
      ) : null}

      {error ? (
        <p className="mb-3 border border-danger px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      <Grid cols={3}>
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
        Konverteringen körs i webbläsaren och STEP-filen lämnar aldrig datorn — bara den
        färdiga modellen sparas. Toleransen är den största spaken: 5 mm mot 0,1 mm är ofta
        15–35 gånger färre trianglar på krökt geometri och visuellt identiskt i layoutskala.
        Går det ändå inte — minnet tar slut på en riktigt tung sammanställning — kör{" "}
        <code className="num">node scripts/step-to-glb.mjs fil.step --id {machine.id}</code>{" "}
        och lägg GLB:n under <code className="num">public/models</code>.
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
              <p key={note} className="mb-2 border border-warn px-2 py-1 text-xs text-warn">
                {note}
              </p>
            ))}
            <p className="mb-2 border border-accent px-2 py-1 text-xs text-accent">
              Modellen är lagrad och inlagd på maskinen. Den syns i konfiguratorns vy
              <strong> Modell</strong> när du har tryckt <strong>Spara</strong> uppe till höger.
            </p>

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
            {applyIssues.length > 0 ? (
              <div className="mt-2 border border-danger px-2 py-1 text-xs text-danger">
                <p className="mb-1">
                  Måtten ur modellen ger en maskin som inte går att spara. Inget är ändrat.
                </p>
                <ul className="ml-4 list-disc">
                  {applyIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {applyNote ? (
              <p className="mt-2 border border-accent px-2 py-1 text-xs text-accent">
                {applyNote} Glöm inte <strong>Spara</strong> uppe till höger.
              </p>
            ) : null}
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Portförslaget lägger in- och utport mitt på kortsidorna. Det är en gissning ur
              fotavtrycket, inte ur geometrin — kontrollera lägena mot ritning innan maskinen
              visas för kund.
            </p>
          </div>
        </div>
      ) : null}

      {machine.model?.glb ? (
        <div className="mt-3 border-t border-divider pt-3">
          <div className="kicker mb-1">Modellens riktning</div>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            Riktningen räknas fram ur måtten vid konverteringen: alla lägen provas mot
            maskinens fotavtryck och det som ger rätt form väljs. Kvar är bara vilket håll
            maskinen pekar åt — vrid ett halvt varv om den står bakvänd, och spegla om den
            är ritad åt andra hållet. Ändringen syns direkt och kräver ingen ny konvertering.
          </p>

          {autoFit ? (
            <p
              className={`mb-2 border px-2 py-1 text-xs ${
                autoFit.confident ? "border-accent text-accent" : "border-warn text-warn"
              }`}
            >
              {autoFit.confident ? (
                <>
                  Riktningen sattes automatiskt till{" "}
                  <strong>{orientationLabel(autoFit.orientation)}</strong> — det är den enda
                  som ger modellen ungefär maskinens form.
                </>
              ) : (
                <>
                  Måtten kunde inte avgöra riktningen — maskinen är för nära kvadratisk, eller
                  så liknar fotavtrycket i biblioteket inte modellen. Ställ den för hand.
                </>
              )}
            </p>
          ) : null}

          <ModelPreview
            url={machine.model.glb}
            orientation={orientation}
            footprint={machine.footprint}
          />

          <div className="mt-2">
            <Grid cols={3}>
              <SelectField
                label="Upp-axel i filen"
                hint="INKAB:s CAD ritar Y upp"
                value={orientation.upAxis ?? "z"}
                options={[
                  { value: "y", label: "Y upp (INKAB:s CAD)" },
                  { value: "z", label: "Z upp (SolidWorks, Inventor)" },
                ]}
                onChange={(v) => setOrientation({ upAxis: v === "y" ? "y" : "z" })}
              />
              <SelectField
                label="Vridning"
                hint="kring upp-axeln"
                value={String(orientation.yawDeg ?? 0)}
                options={YAW_STEPS.map((deg) => ({ value: String(deg), label: `${deg}°` }))}
                onChange={(v) =>
                  setOrientation({ yawDeg: Number(v) as (typeof YAW_STEPS)[number] })
                }
              />
              <SelectField
                label="Spegling"
                hint="tvärs flödet"
                value={orientation.flipped ? "ja" : "nej"}
                options={[
                  { value: "nej", label: "Som ritad" },
                  { value: "ja", label: "Speglad" },
                ]}
                onChange={(v) => setOrientation({ flipped: v === "ja" })}
              />
            </Grid>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Riktningen sparas på maskinen och gäller överallt modellen visas. Glöm inte{" "}
            <strong>Spara</strong>.
          </p>
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
