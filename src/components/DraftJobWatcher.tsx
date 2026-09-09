"use client";

import { useCallback, useEffect, useState } from "react";
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
    steps?: { name: string; ok: boolean; error?: string }[];
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

const POLL_MS = 5000;

export function DraftJobWatcher() {
  const { load } = useConfigStore();
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
        timer = setTimeout(tick, POLL_MS);
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

  const minutes = Math.max(1, Math.round((Date.now() - new Date(job.createdAt).getTime()) / 60000));

  if (job.status === "queued" || job.status === "running") {
    return (
      <div className="blueprint absolute left-3 top-3 flex max-w-[380px] items-center gap-3 bg-white px-3 py-2 shadow-sm">
        <Spinner />
        <span className="min-w-0 text-xs leading-tight">
          <span className="block">Assistenten bygger ditt förslag</span>
          <span className="block text-muted">
            {job.step} · {minutes} min
          </span>
        </span>
        <button onClick={dismiss} className="ml-1 text-muted hover:text-ink" aria-label="Avbryt">
          ×
        </button>
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
                  load(variant.config, { resetHistory: false });
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
