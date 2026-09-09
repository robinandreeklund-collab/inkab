"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { currentJobId, forgetJob } from "@/lib/draftJobClient";
import { computeLayout } from "@/lib/layout";
import { meters } from "@/lib/format";
import { Button } from "./ui";
import type { Configuration } from "@/lib/types";

/**
 * Beskedet om förslaget som byggs i bakgrunden.
 *
 * Kunden ska inte behöva undra om något händer, och inte heller sitta och
 * vänta: medan jobbet går står en rad om vad assistenten gör just nu, och när
 * det är klart läggs förslaget fram att titta på. Ingenting tillämpas åt
 * henne — hon väljer själv, precis som med assistentens andra förslag.
 */

type Job = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  step: string;
  summary: string;
  variants: { id: string; name: string; description: string; config: Configuration }[];
  detail?: {
    model?: string;
    provider?: string;
    rounds?: number;
    stopReason?: string;
    steps?: { name: string; ok: boolean; error?: string; ms?: number }[];
    timeline?: { round: number; modelMs: number; toolMs: number; tools: number }[];
    totalMs?: number;
    stepSince?: string;
    scaleVerified?: boolean | null;
  };
  error: string | null;
  createdAt: string;
};

/** Verktygsnamnen på svenska, samma ord som i assistentpanelen. */
const TOOL_LABEL: Record<string, string> = {
  get_machine_library: "läste maskinbiblioteket",
  get_current_layout: "kontrollerade layouten",
  set_flow: "satte flödet",
  add_machine: "lade till maskin",
  remove_machine: "tog bort maskin",
  set_hall: "satte hallens mått",
  clear_line: "tömde linjen",
  draw_hall: "ritade upp lokalen",
  estimate_price: "räknade pris",
  propose_variant: "sparade förslag",
};

/** Medan jobbet går: tillräckligt tätt för att kännas levande. */
const POLL_RUNNING_MS = 2000;
const POLL_IDLE_MS = 5000;

export function DraftJobWatcher() {
  const { load, note } = useConfigStore();
  const [job, setJob] = useState<Job | null>(null);
  const [open, setOpen] = useState(true);
  const [gone, setGone] = useState(false);

  const poll = useCallback(async () => {
    const id = currentJobId();
    if (!id) return null;
    try {
      const response = await fetch(`/api/ai/draft/${encodeURIComponent(id)}`);
      if (response.status === 404) {
        forgetJob();
        setGone(true);
        return null;
      }
      const body = (await response.json()) as { job?: Job };
      return body.job ?? null;
    } catch {
      // Nätet hackar. Nästa runda får försöka igen.
      return null;
    }
  }, []);

  /*
   * Jobbets utgång hör hemma i projektloggen: underlaget skickades in där, och
   * det som kom tillbaka är en del av samma historia. Raden skrivs en gång.
   */
  const logged = useRef<string | null>(null);
  useEffect(() => {
    if (!job || job.status === "queued" || job.status === "running") return;
    if (logged.current === job.id) return;
    logged.current = job.id;
    if (job.status === "failed") {
      note("job", "Bakgrundsjobbet avbröts", job.error ?? undefined);
    } else if (job.variants.length > 0) {
      note("job", `Förslag från underlaget klart: ${job.variants[0].name}`, job.summary);
    } else {
      note("job", "Bakgrundsjobbet blev klart utan förslag", job.summary);
    }
  }, [job, note]);

  useEffect(() => {
    if (gone) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const next = await poll();
      if (!alive) return;
      if (next) setJob(next);
      // Klart eller avbrutet: sluta fråga.
      if (!next || next.status === "queued" || next.status === "running") {
        timer = setTimeout(tick, next ? POLL_RUNNING_MS : POLL_IDLE_MS);
      }
    };
    tick();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [poll, gone]);

  if (!job || gone) return null;

  const dismiss = async () => {
    const id = job.id;
    forgetJob();
    setGone(true);
    await fetch(`/api/ai/draft/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  };

  const since = (iso?: string) =>
    iso ? Math.round((Date.now() - new Date(iso).getTime()) / 1000) : 0;
  const totalSeconds = since(job.createdAt);
  const stepSeconds = since(job.detail?.stepSince ?? job.createdAt);
  const clock = (seconds: number) =>
    seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;

  if (job.status === "queued" || job.status === "running") {
    const steps = job.detail?.steps ?? [];
    return (
      <div className="blueprint absolute left-3 top-3 max-w-[380px] bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-3">
          <Spinner />
          <span className="min-w-0 text-xs leading-tight">
            <span className="block">Assistenten bygger ditt förslag</span>
            <span className="block text-muted">
              {job.step} sedan {clock(stepSeconds)} · totalt {clock(totalSeconds)}
            </span>
          </span>
          <button onClick={dismiss} className="ml-auto text-muted hover:text-ink" aria-label="Avbryt">
            ×
          </button>
        </div>

        {/* Det som redan är gjort. Utan den här listan ser en lång stund ut
            som att något hängt sig. */}
        {steps.length > 0 ? (
          <ul className="mt-2 space-y-0.5 border-t border-divider pt-2 text-[11px] text-muted">
            {steps.slice(-5).map((step, index) => (
              <li key={index}>✓ {TOOL_LABEL[step.name] ?? step.name}</li>
            ))}
            <li className="pt-1">
              Modellen tänker mellan stegen — det är oftast där tiden går. Admin ser hela
              tidsuppdelningen under Assistent.
            </li>
          </ul>
        ) : null}
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="absolute left-3 top-3 max-w-[420px] border border-danger bg-white px-3 py-2 text-xs shadow-sm">
        <div className="mb-1">Förslaget blev inte klart</div>
        <p className="mb-2 leading-relaxed text-muted">
          {job.error ?? "Assistenten kom inte i mål."}
        </p>
        <Button size="sm" onClick={dismiss}>
          Stäng
        </Button>
      </div>
    );
  }

  // Rubriken ska stämma med vad som faktiskt kom ut. "Klart" över en ruta som
  // säger att inget blev gjort är det som gör ett misslyckande obegripligt.
  const delivered = job.variants.length > 0;
  const heading = delivered ? "Ditt förslag är klart" : "Assistenten kom inte i mål";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="blueprint absolute left-3 top-3 flex items-center gap-2 border-accent bg-white px-3 py-2 text-xs shadow-sm"
      >
        <span className={`h-2 w-2 flex-none ${delivered ? "bg-accent" : "bg-warn"}`} />
        {heading}
      </button>
    );
  }

  return (
    <div
      className={`absolute left-3 top-3 z-10 max-w-[440px] border bg-white p-3 text-sm shadow-lg ${
        delivered ? "border-accent" : "border-divider"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 flex-none ${delivered ? "bg-accent" : "bg-warn"}`} />
        <h2 className="kicker">{heading}</h2>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto text-muted hover:text-ink"
          aria-label="Fäll ihop"
        >
          –
        </button>
      </div>

      {/* Assistenten uppmanas att säga ifrån själv när skalan är gissad. Det
          här säger det oavsett vad den skrev. */}
      {job.detail?.scaleVerified === false ? (
        <p className="mb-2 border border-warn px-2 py-1 text-xs leading-relaxed text-warn">
          Skalan är inte belagd. Assistenten hittade inget mått att skala ritningen efter, så
          hallens mått är en gissning — mät i verkligheten innan du går vidare.
        </p>
      ) : null}

      {job.summary ? (
        <p className="scroll-thin mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
          {job.summary}
        </p>
      ) : null}

      {!delivered ? (
        <div className="mb-3 text-xs leading-relaxed text-muted">
          <p className="mb-2">
            Inget förslag sparades. Texten ovan är vad assistenten svarade; nedan står vad den
            gjorde.
          </p>
          <JobTrace detail={job.detail} />
        </div>
      ) : (
        <ul className="mb-3 space-y-2">
          {job.variants.map((variant) => (
            <li key={variant.id} className="blueprint p-2">
              <div className="text-[15px] leading-tight">{variant.name}</div>
              <p className="mb-1 mt-1 text-xs leading-relaxed text-muted">{variant.description}</p>
              <div className="mb-2 flex flex-wrap gap-x-3 text-[11px] text-muted">
                <span className="num">{summarise(variant.config)}</span>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  load(variant.config, {
                    resetHistory: false,
                    note: `Använde förslaget från underlaget: ${variant.name}`,
                  });
                  setOpen(false);
                }}
              >
                Använd förslaget
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={dismiss}>
          Klart — ta bort
        </Button>
        <span className="text-[11px] text-muted">
          {job.detail?.model ? (
            <>
              Byggt av <span className="num">{job.detail.model}</span>
              {job.detail.rounds ? ` på ${job.detail.rounds} rundor. ` : ". "}
            </>
          ) : null}
          Du kan ångra med Ctrl+Z om du använder ett förslag.
        </span>
      </div>
    </div>
  );
}

/**
 * Vad assistenten gjorde.
 *
 * Utan den här listan är ett misslyckat jobb en tom ruta: kunden ser att det
 * inte blev något men inte varför. Verktygens egna fel är det som brukar
 * förklara det — en ritning utan skala, en maskin som inte finns, en utgång
 * som redan är upptagen.
 */
function JobTrace({ detail }: { detail: Job["detail"] }) {
  if (!detail) return null;
  const steps = detail.steps ?? [];
  const failed = steps.filter((step) => !step.ok);

  return (
    <div className="border border-divider bg-paper px-2 py-2">
      <div className="mb-1">
        {detail.model ? (
          <>
            <span className="num">{detail.model}</span>
            {detail.rounds ? `, ${detail.rounds} arbetsrundor` : ""}
            {typeof detail.totalMs === "number"
              ? `, ${Math.round(detail.totalMs / 1000)} s`
              : ""}
            {detail.stopReason === "max_rounds" ? " — nådde taket och hann inte bli klar" : ""}
          </>
        ) : null}
      </div>
      {steps.length === 0 ? (
        <p>Inga verktyg anropades. Modellen läste förmodligen aldrig underlaget.</p>
      ) : (
        <ul className="space-y-0.5">
          {steps.slice(-8).map((step, index) => (
            <li key={index} className={step.ok ? "" : "text-danger"}>
              {step.ok ? "✓" : "✕"} {TOOL_LABEL[step.name] ?? step.name}
              {step.error ? ` — ${step.error}` : ""}
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 ? (
        <p className="mt-1">
          Felen ovan kommer från verktygen, inte från modellen: de säger vad den försökte göra som
          inte gick.
        </p>
      ) : null}
    </div>
  );
}

/** Kort fakta om vad förslaget faktiskt innehåller. */
function summarise(config: Configuration): string {
  const layout = computeLayout(config);
  const walls = config.drawn.filter((d) => d.kind === "wall").length;
  const doors = config.drawn.filter((d) => d.kind === "door").length;
  return [
    `${config.line.length} maskiner`,
    `linje ${meters(layout.metrics.totalLengthMm)} m`,
    `hall ${meters(config.hall.lengthMm)} × ${meters(config.hall.widthMm)} m`,
    walls ? `${walls} väggar` : null,
    doors ? `${doors} portar` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className="flex-none animate-spin" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#d6dde5" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#5980a6" strokeWidth="3" />
    </svg>
  );
}
