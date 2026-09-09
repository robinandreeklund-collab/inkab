/**
 * En körning som text att skicka vidare.
 *
 * När något tar sex minuter är frågan var tiden och tokenen tar vägen, och
 * svaret finns i rundorna: modellens egen tid mot verktygens, vad varje runda
 * kostade in och ut, hur mycket som var cacheträffar. Rapporten är gjord för
 * att klistras in i ett mejl — därför ren text, inga färger, inga tabeller som
 * bara ser rätt ut i en webbläsare.
 */

export type ReportRound = {
  round: number;
  modelMs: number;
  toolMs: number;
  tools: number;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type ReportStep = { name: string; ok: boolean; error?: string; ms?: number };

export type RunReport = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  note?: string;
  fileNames?: string[];
  summary?: string;
  error?: string | null;
  variantCount?: number;
  detail?: {
    model?: string;
    provider?: string;
    rounds?: number;
    stopReason?: string;
    steps?: ReportStep[];
    timeline?: ReportRound[];
    totalMs?: number;
  };
};

const seconds = (ms?: number) => (typeof ms === "number" ? (ms / 1000).toFixed(1) : "–");
const pad = (value: string | number, width: number) => String(value).padStart(width);
const padEnd = (value: string, width: number) => value.padEnd(width);

export function usageTotals(rounds: ReportRound[]) {
  return rounds.reduce(
    (sum, round) => ({
      input: sum.input + (round.usage?.input ?? 0),
      output: sum.output + (round.usage?.output ?? 0),
      cacheRead: sum.cacheRead + (round.usage?.cacheRead ?? 0),
      cacheWrite: sum.cacheWrite + (round.usage?.cacheWrite ?? 0),
      modelMs: sum.modelMs + round.modelMs,
      toolMs: sum.toolMs + round.toolMs,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, modelMs: 0, toolMs: 0 },
  );
}

export function runReport(job: RunReport): string {
  const detail = job.detail ?? {};
  const rounds = detail.timeline ?? [];
  const steps = detail.steps ?? [];
  const totals = usageTotals(rounds);
  const lines: string[] = [];

  lines.push(`INKAB — assistentkörning ${job.id}`);
  lines.push(
    `Modell: ${detail.model ?? "okänd"} (${detail.provider ?? "okänd leverantör"}) · ` +
      `Status: ${job.status}${detail.stopReason ? ` (${detail.stopReason})` : ""} · ` +
      `Rundor: ${detail.rounds ?? rounds.length}`,
  );
  lines.push(
    `Start: ${job.createdAt} · Slut: ${job.updatedAt} · ` +
      `Total tid: ${seconds(detail.totalMs)} s ` +
      `(modell ${seconds(totals.modelMs)} s, verktyg ${seconds(totals.toolMs)} s)`,
  );
  if (job.fileNames?.length) lines.push(`Bilagor: ${job.fileNames.join(", ")}`);
  if (job.note) lines.push(`Kundens ord: ${job.note}`);
  if (typeof job.variantCount === "number") lines.push(`Sparade förslag: ${job.variantCount}`);
  lines.push("");

  if (rounds.length > 0) {
    lines.push("Runda  Modell    Verktyg   In-token  Cache-läs  Cache-skriv  Ut-token  Anrop");
    for (const round of rounds) {
      lines.push(
        [
          pad(round.round, 5),
          pad(`${seconds(round.modelMs)} s`, 9),
          pad(`${seconds(round.toolMs)} s`, 9),
          pad(round.usage?.input ?? 0, 9),
          pad(round.usage?.cacheRead ?? 0, 10),
          pad(round.usage?.cacheWrite ?? 0, 12),
          pad(round.usage?.output ?? 0, 9),
          pad(round.tools, 6),
        ].join(""),
      );
    }
    lines.push(
      [
        padEnd("SUMMA", 5),
        pad(`${seconds(totals.modelMs)} s`, 9),
        pad(`${seconds(totals.toolMs)} s`, 9),
        pad(totals.input, 9),
        pad(totals.cacheRead, 10),
        pad(totals.cacheWrite, 12),
        pad(totals.output, 9),
        pad(steps.length, 6),
      ].join(""),
    );
    lines.push("");
  }

  if (steps.length > 0) {
    lines.push("Verktygsanrop i ordning:");
    steps.forEach((step, index) => {
      lines.push(
        `${pad(index + 1, 3)}. ${step.ok ? "ok  " : "FEL "} ${step.name}` +
          (typeof step.ms === "number" ? ` (${step.ms} ms)` : "") +
          (step.error ? `\n     ${step.error}` : ""),
      );
    });
    lines.push("");
  }

  if (job.error) {
    lines.push(`Fel: ${job.error}`);
    lines.push("");
  }
  if (job.summary) {
    lines.push("Assistentens svar:");
    lines.push(job.summary);
  }

  return lines.join("\n");
}
