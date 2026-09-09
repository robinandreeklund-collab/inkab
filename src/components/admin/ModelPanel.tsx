"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tag } from "../ui";
import { Grid, NumField, Panel, SelectField, TextField } from "./fields";
import { collectIssues, machineSchema } from "@/lib/machineSchema";
import { applyModelFootprint, applySuggestedPorts } from "@/lib/cad/applyModel";
import { addYaw, flowFromPicks, snapToEdge } from "@/lib/cad/pickFlow";
import {
  bestOrientation,
  DEFAULT_ORIENTATION,
  orientationLabel,
  orientedFootprint,
  YAW_STEPS,
  type ModelOrientation,
} from "@/lib/cad/orientation";
import { ModelPreview } from "./ModelPreview";
import { STAGE_TEXT, useStepConversion, type ConversionResult } from "./useStepConversion";
import type { Machine } from "@/lib/types";

/**
 * Maskinens 3D-modell, ur dess STEP-fil.
 *
 * Modellen är ritningen. Måtten ur den är mätta och inte uppskattade, så de
 * tas över automatiskt — biblioteket ska följa konstruktionen, inte tvärtom.
 * Går det inte att göra det utan att bryta mot schemat ändras ingenting och
 * panelen säger varför.
 */

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
  modelDefaults,
  onModelDefaultsChange,
  onChange,
}: {
  machine: Machine;
  /** Riktningen nya modeller tolkas med. Gäller hela biblioteket. */
  modelDefaults: ModelOrientation | undefined;
  onModelDefaultsChange: (orientation: ModelOrientation) => void;
  onChange: (machine: Machine) => void;
}) {
  const defaults = modelDefaults ?? DEFAULT_ORIENTATION;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [tolerance, setTolerance] = useState(2);
  const [minPart, setMinPart] = useState(50);
  const [proxy, setProxy] = useState(true);

  const { convert, stage, elapsed, busy, error, setError } = useStepConversion();
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [stored, setStored] = useState<StoredModel[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [autoFit, setAutoFit] = useState<ReturnType<typeof bestOrientation> | null>(null);
  /** Utpekning av flödet: null, väntar på inport, eller på utport. */
  const [picking, setPicking] = useState<null | "in" | "out">(null);
  const [inPoint, setInPoint] = useState<{ x: number; y: number } | null>(null);

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
    setIssues([]);
    setNote(null);
    setAutoFit(null);
    loadStored();
  }, [loadStored, setError]);

  /** Byter maskin bara om resultatet går att spara. */
  const apply = (candidate: Machine, applied: string) => {
    const parsed = machineSchema.safeParse(candidate);
    if (!parsed.success) {
      setIssues(collectIssues(parsed.error).map((i) => `${i.path}: ${i.message}`));
      setNote(null);
      return false;
    }
    setIssues([]);
    setNote(applied);
    onChange(candidate);
    return true;
  };

  const run = async (file: File) => {
    setResult(null);
    setIssues([]);
    setNote(null);

    const converted = await convert(file, machine.id, {
      toleranceMm: tolerance,
      minPartMm: minPart,
      proxy,
    });
    if (!converted) return;

    setResult(converted);
    loadStored();

    /*
     * Riktningen kommer ur bibliotekets inställning. Alla filer ur samma CAD
     * delar konvention — en rullbana och en lättpress ser inget lika ut men
     * ritas likadant — så det är ingenting att räkna fram per maskin. Att
     * gissa den ur bibliotekets uppskattade mått gav rätt för den ena och
     * fel för den andra.
     *
     * En riktning som redan är inställd för hand står över: har någon vridit
     * maskinen rätt ska en ny konvertering inte slå bort det.
     */
    const orientation: ModelOrientation = {
      upAxis: machine.model?.upAxis ?? defaults.upAxis,
      yawDeg: machine.model?.yawDeg ?? defaults.yawDeg,
      flipped: machine.model?.flipped ?? defaults.flipped,
    };

    /*
     * Måtten får ändå säga sitt, men bara som ett tips och bara när
     * referensen är värd att lita på. Är fotavtrycket kontrollerat mot
     * ritning och formen pekar entydigt åt ett annat håll är det värt att
     * nämna — annars är det brus.
     */
    const fit = bestOrientation(converted.footprint, machine.footprint);
    const disagrees =
      fit.orientation.upAxis !== orientation.upAxis ||
      (fit.orientation.yawDeg ?? 0) % 180 !== (orientation.yawDeg ?? 0) % 180;
    setAutoFit(machine.dimensionsVerified === true && fit.confident && disagrees ? fit : null);

    // Modellen är ritningen: måtten ur den tas över utan att någon behöver
    // trycka på något. Går det inte utan att bryta mot schemat lämnas
    // maskinen orörd och felen står kvar i panelen.
    const measured = orientedFootprint(converted.footprint, orientation);
    const { machine: withSize, movedPorts, scaledZones } = applyModelFootprint(
      { ...machine, model: { glb: converted.model.glb, proxy: converted.model.proxy, ...orientation } },
      measured,
    );

    const changed =
      Math.abs(machine.footprint.lengthMm - measured.lengthMm) > 10 ||
      Math.abs(machine.footprint.widthMm - measured.widthMm) > 10 ||
      Math.abs(machine.footprint.heightMm - measured.heightMm) > 10;

    const applied = apply(
      withSize,
      changed
        ? `Måtten är hämtade ur modellen: ${(measured.lengthMm / 1000).toFixed(2).replace(".", ",")} × ` +
            `${(measured.widthMm / 1000).toFixed(2).replace(".", ",")} × ${meters(measured.heightMm)}.` +
            (movedPorts.length > 0
              ? ` Portarna skalades med — kontrollera ${movedPorts.join(", ")}.`
              : "") +
            (scaledZones > 0
              ? ` ${scaledZones === 1 ? "Zonen räknades" : `${scaledZones} zoner räknades`} om.`
              : "")
        : "Modellen stämmer med måtten i biblioteket.",
    );

    // Kunde måtten inte tas över får modellen ändå läggas in; det är den som
    // ska granskas för att förstå varför måtten inte dög.
    if (!applied) {
      onChange({
        ...machine,
        model: { glb: converted.model.glb, proxy: converted.model.proxy, ...orientation },
      });
    }
  };

  const reapply = () => {
    if (!result) return;
    const measured = orientedFootprint(result.footprint, orientation);
    const { machine: candidate, movedPorts, scaledZones } = applyModelFootprint(machine, measured);
    apply(
      candidate,
      `Måtten är hämtade ur modellen.` +
        (movedPorts.length > 0
          ? ` Portarna skalades med — kontrollera ${movedPorts.join(", ")}.`
          : "") +
        (scaledZones > 0
          ? ` ${scaledZones === 1 ? "Zonen räknades" : `${scaledZones} zoner räknades`} om.`
          : ""),
    );
  };

  /*
   * Flödet pekas ut på maskinen i stället för att härledas ur filens axlar.
   * Två klick — där paketen kommer in och där de går ut — ger både vilken väg
   * maskinen ska vändas och var portarna sitter. Det är samma sak man annars
   * gör genom att skriva in portkoordinater för hand, fast utan att behöva
   * tänka i maskinens lokala system.
   */
  const pick = (point: { x: number; y: number }) => {
    if (picking === "in") {
      setInPoint(point);
      setPicking("out");
      return;
    }
    if (picking !== "out" || !inPoint) return;

    setPicking(null);
    const flow = flowFromPicks(inPoint, point, machine.footprint);
    const footprint = { ...machine.footprint, ...flow.footprint };

    const ports = machine.ports.length > 0 ? machine.ports : applySuggestedPorts(machine).ports;
    const next: Machine = {
      ...machine,
      footprint,
      ports: ports.map((port) =>
        port.role === "in"
          ? { ...port, pos: snapToEdge(flow.inPos, footprint, "in"), dir: "x+" as const }
          : { ...port, pos: snapToEdge(flow.outPos, footprint, "out"), dir: "x+" as const },
      ),
      model: machine.model
        ? { ...machine.model, yawDeg: addYaw(machine.model.yawDeg, flow.yawDelta) }
        : machine.model,
      dimensionsVerified: false,
    };

    apply(
      next,
      flow.yawDelta === 0
        ? "Flödet stämde redan. Portarna är satta där du pekade."
        : `Maskinen vändes ${flow.yawDelta}° och portarna är satta där du pekade.` +
            (flow.swapsFootprint
              ? ` Längd och bredd bytte plats: ${(footprint.lengthMm / 1000)
                  .toFixed(2)
                  .replace(".", ",")} × ${(footprint.widthMm / 1000).toFixed(2).replace(".", ",")} m.`
              : ""),
    );
  };

  const removeStored = async (id: string) => {
    await fetch(`/api/admin/model?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (machine.model?.glb === `/api/models/${id}`) onChange({ ...machine, model: undefined });
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

  const measured = result ? orientedFootprint(result.footprint, orientation) : null;
  const diff = measured
    ? ([
        ["Längd", machine.footprint.lengthMm, measured.lengthMm],
        ["Bredd", machine.footprint.widthMm, measured.widthMm],
        ["Höjd", machine.footprint.heightMm, measured.heightMm],
      ] as const)
    : [];

  return (
    <Panel
      title="3D-modell från STEP"
      description="Välj maskinens STEP-fil. Den konverteras här i webbläsaren och måtten tas över."
      action={
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".step,.stp,.STEP,.STP"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) run(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? `${STAGE_TEXT[stage!] ?? "Arbetar"}… ${elapsed} s` : "+ STEP-fil"}
          </Button>
        </div>
      }
    >
      {busy ? (
        <p className="mb-3 border border-divider bg-paper px-3 py-2 text-xs text-muted">
          {STAGE_TEXT[stage!] ?? "Arbetar"}. Konverteringen körs på den här datorn och tar
          sekunder till minuter beroende på hur mycket geometri sammanställningen innehåller.
          Lämna fliken öppen — gränssnittet fungerar under tiden.
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
      </p>

      {result ? (
        <div className="mt-3 border border-divider">
          <div className="flex flex-wrap items-center gap-2 border-b border-divider bg-paper px-3 py-2">
            <span className="kicker">Resultat</span>
            <Tag tone="accent">
              {mb(result.stats.stepBytes)} → {mb(result.stats.glbBytes)}
            </Tag>
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
            {result.notes.map((n) => (
              <p key={n} className="mb-2 border border-warn px-2 py-1 text-xs text-warn">
                {n}
              </p>
            ))}
            {note ? (
              <p className="mb-2 border border-accent px-2 py-1 text-xs text-accent">
                {note} Glöm inte <strong>Spara</strong> uppe till höger.
              </p>
            ) : null}
            {issues.length > 0 ? (
              <div className="mb-2 border border-danger px-2 py-1 text-xs text-danger">
                <p className="mb-1">
                  Måtten ur modellen ger en maskin som inte går att spara. Måtten är
                  oförändrade; modellen är inlagd.
                </p>
                <ul className="ml-4 list-disc">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}

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
                    <td className={Math.abs(before - after) > 10 ? "num py-1 text-danger" : "num py-1"}>
                      {meters(after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={reapply}>
                Hämta måtten igen
              </Button>
              {machine.aux ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    apply(
                      applySuggestedPorts(machine),
                      "In- och utport är satta mitt på kortsidorna. Kontrollera lägena mot ritning.",
                    )
                  }
                >
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
          </div>
        </div>
      ) : null}

      {machine.model?.glb ? (
        <div className="mt-3 border-t border-divider pt-3">
          <div className="kicker mb-1">Modellens riktning</div>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            Nya modeller tolkas med bibliotekets standardriktning (
            {orientationLabel(defaults)}). Stämmer det inte för just den här filen ändrar du
            nedan — ändringen syns direkt och gäller bara den här maskinen.
          </p>

          {autoFit ? (
            <p className="mb-2 border border-warn px-2 py-1 text-xs text-warn">
              Måtten antyder <strong>{orientationLabel(autoFit.orientation)}</strong> i stället.
              Maskinens fotavtryck är kontrollerat mot ritning, så det är värt att titta på —
              men kontrollera i vyn innan du ändrar.
            </p>
          ) : null}

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={picking ? "primary" : "secondary"}
              onClick={() => {
                setInPoint(null);
                setPicking(picking ? null : "in");
              }}
            >
              {picking ? "Avbryt utpekning" : "Peka ut flödet"}
            </Button>
            <span className="text-[11px] leading-relaxed text-muted">
              {picking === "in"
                ? "Klicka på modellen där paketen kommer in."
                : picking === "out"
                  ? "Klicka där de går ut."
                  : "Två klick i vyn sätter både vändningen och portarna — enklare än att skriva koordinater."}
            </span>
          </div>

          <ModelPreview
            url={machine.model.glb}
            orientation={orientation}
            footprint={machine.footprint}
            picking={picking}
            onPick={pick}
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
                  <span className="ml-auto flex items-center gap-2">
                    {active ? (
                      <Tag tone="accent">används</Tag>
                    ) : (
                      <button
                        className="text-muted hover:text-ink"
                        onClick={() => onChange({ ...machine, model: { ...orientation, glb: url } })}
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
        <div className="kicker mb-1">Standardriktning för nya modeller</div>
        <p className="mb-2 text-[11px] leading-relaxed text-muted">
          Gäller <strong>hela biblioteket</strong>, inte bara den här maskinen. Riktningen hör
          till CAD-systemet: alla filer ur samma system delar konvention, oavsett hur olika
          maskinerna ser ut. Ändra den här om ni byter CAD eller exportinställning.
        </p>
        <Grid cols={3}>
          <SelectField
            label="Upp-axel"
            value={defaults.upAxis ?? "z"}
            options={[
              { value: "y", label: "Y upp" },
              { value: "z", label: "Z upp" },
            ]}
            onChange={(v) => onModelDefaultsChange({ ...defaults, upAxis: v === "y" ? "y" : "z" })}
          />
          <SelectField
            label="Vridning"
            value={String(defaults.yawDeg ?? 0)}
            options={YAW_STEPS.map((deg) => ({ value: String(deg), label: `${deg}°` }))}
            onChange={(v) =>
              onModelDefaultsChange({
                ...defaults,
                yawDeg: Number(v) as (typeof YAW_STEPS)[number],
              })
            }
          />
          <SelectField
            label="Spegling"
            value={defaults.flipped ? "ja" : "nej"}
            options={[
              { value: "nej", label: "Som ritad" },
              { value: "ja", label: "Speglad" },
            ]}
            onChange={(v) => onModelDefaultsChange({ ...defaults, flipped: v === "ja" })}
          />
        </Grid>
      </div>

      <div className="mt-3 border-t border-divider pt-3">
        <Grid cols={2}>
          <TextField
            label="GLB"
            mono
            value={machine.model?.glb ?? ""}
            placeholder="/models/tsl-enkel.glb"
            onChange={(v) =>
              onChange({
                ...machine,
                model: v ? { ...orientation, glb: v, proxy: machine.model?.proxy } : undefined,
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
                  ? { ...machine.model, proxy: v || undefined }
                  : machine.model,
              })
            }
          />
        </Grid>
      </div>
    </Panel>
  );
}
