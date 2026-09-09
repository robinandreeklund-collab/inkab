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
  error: string | null;
  createdAt: string;
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="blueprint absolute left-3 top-3 flex items-center gap-2 border-accent bg-white px-3 py-2 text-xs shadow-sm"
      >
        <span className="h-2 w-2 flex-none bg-accent" />
        Ditt förslag är klart
      </button>
    );
  }

  return (
    <div className="absolute left-3 top-3 z-10 max-w-[440px] border border-accent bg-white p-3 text-sm shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 flex-none bg-accent" />
        <h2 className="kicker">Ditt förslag är klart</h2>
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

      {job.variants.length === 0 ? (
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Assistenten kom inte fram till ett förslag ur underlaget. Läs texten ovan — den säger
          oftast vad som saknas, till exempel ett känt mått att skala ritningen efter.
        </p>
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

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={dismiss}>
          Klart — ta bort
        </Button>
        <span className="text-[11px] text-muted">
          Du kan ångra med Ctrl+Z om du använder ett förslag.
        </span>
      </div>
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
