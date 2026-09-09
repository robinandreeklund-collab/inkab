"use client";

import { useCallback, useEffect, useState } from "react";
import { runReport, usageTotals, type RunReport } from "@/lib/runReport";
import { Button, Tag } from "../ui";
import { Panel } from "./fields";

/**
 * Assistentens körningar, med tiden och tokenen synliga.
 *
 * "Läser maskinbiblioteket · 6 min" säger att något tar tid men inte vad. Här
 * står rundorna: hur länge modellen själv höll på, hur länge verktygen tog, och
 * vad varje runda kostade in och ut. Rapportknappen ger alltihop som text att
 * klistra in i ett mejl.
 */

const seconds = (ms?: number) => (typeof ms === "number" ? Math.round(ms / 1000) : null);
const thousands = (value: number) => value.toLocaleString("sv-SE");

export function RunsPanel() {
  const [jobs, setJobs] = useState<RunReport[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/runs");
      if (!response.ok) {
        setError("Kunde inte läsa körningarna.");
        return;
      }
      const body = await response.json();
      setJobs(body.jobs ?? []);
      setError(null);
    } catch {
      setError("Nätverket svarade inte.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (job: RunReport) => {
    const text = runReport(job);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(job.id);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      window.prompt("Kopiera rapporten:", text);
    }
  };

  return (
    <Panel
      title="Körningar"
      description="Var tiden och tokenen tar vägen i assistentens bakgrundsjobb."
      action={
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? "Läser…" : "Uppdatera"}
        </Button>
      }
    >
      {error ? (
        <p className="mb-3 border border-danger px-2 py-1 text-xs text-danger">{error}</p>
      ) : null}

      {jobs.length === 0 ? (
        <p className="text-xs text-muted">
          Inga körningar än. Bakgrundsjobb hamnar här — en fråga i assistentpanelen gör det inte,
          den lever bara så länge fliken är öppen.
        </p>
      ) : (
        <ul className="text-xs">
          {jobs.map((job) => {
            const rounds = job.detail?.timeline ?? [];
            const totals = usageTotals(rounds);
            const total = seconds(job.detail?.totalMs);
            return (
              <li key={job.id} className="border-t border-divider py-2 first:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={job.status === "done" ? "accent" : job.status === "failed" ? "warn" : "muted"}>
                    {job.status}
                  </Tag>
                  <span className="num">{job.detail?.model ?? "okänd modell"}</span>
                  <span className="text-muted">
                    {job.detail?.rounds ?? rounds.length} rundor
                    {total !== null ? ` · ${total} s` : ""}
                    {totals.input + totals.cacheRead > 0
                      ? ` · in ${thousands(totals.input + totals.cacheRead)} tk` +
                        (totals.cacheRead ? ` (varav cache ${thousands(totals.cacheRead)})` : "") +
                        ` · ut ${thousands(totals.output)} tk`
                      : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => setOpen(open === job.id ? null : job.id)}
                      className="text-accent hover:underline"
                    >
                      {open === job.id ? "Dölj" : "Visa"}
                    </button>
                    <button onClick={() => copy(job)} className="text-accent hover:underline">
                      {copied === job.id ? "Kopierat" : "Kopiera rapport"}
                    </button>
                  </span>
                </div>

                <div className="mt-1 text-muted">
                  {new Date(job.createdAt).toLocaleString("sv-SE")}
                  {job.fileNames?.length ? ` · ${job.fileNames.join(", ")}` : ""}
                  {job.note ? ` · "${job.note}"` : ""}
                </div>

                {open === job.id ? (
                  <div className="mt-2 border border-divider bg-paper p-2">
                    {rounds.length > 0 ? (
                      <table className="w-full text-[11px]">
                        <thead className="text-muted">
                          <tr>
                            <th className="text-left">Runda</th>
                            <th className="text-right">Modell</th>
                            <th className="text-right">Verktyg</th>
                            <th className="text-right">In</th>
                            <th className="text-right">Cache</th>
                            <th className="text-right">Ut</th>
                            <th className="text-right">Anrop</th>
                          </tr>
                        </thead>
                        <tbody className="num">
                          {rounds.map((round) => (
                            <tr key={round.round}>
                              <td>{round.round}</td>
                              <td className="text-right">{(round.modelMs / 1000).toFixed(1)} s</td>
                              <td className="text-right">{(round.toolMs / 1000).toFixed(1)} s</td>
                              <td className="text-right">{thousands(round.usage?.input ?? 0)}</td>
                              <td className="text-right">{thousands(round.usage?.cacheRead ?? 0)}</td>
                              <td className="text-right">{thousands(round.usage?.output ?? 0)}</td>
                              <td className="text-right">{round.tools}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-muted">Inga rundor registrerade.</p>
                    )}

                    {job.detail?.steps?.length ? (
                      <ul className="mt-2 space-y-0.5 text-[11px]">
                        {job.detail.steps.map((step, index) => (
                          <li key={index} className={step.ok ? "" : "text-danger"}>
                            {step.ok ? "✓" : "✕"} {step.name}
                            {typeof step.ms === "number" ? ` (${step.ms} ms)` : ""}
                            {step.error ? ` — ${step.error}` : ""}
                            {step.input ? (
                              <span className="num block pl-4 text-muted">{step.input}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {job.error ? <p className="mt-2 text-danger">{job.error}</p> : null}
                    {job.summary ? (
                      <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed">
                        {job.summary}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
