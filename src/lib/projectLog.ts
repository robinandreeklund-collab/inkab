import type { Configuration } from "./types";
import { meters } from "./format";

/**
 * Projektets logg.
 *
 * En konfiguration säger vad som gäller nu. Den säger ingenting om hur man kom
 * dit: vilken ritning som låg till grund, vad kunden frågade assistenten, vad
 * den svarade, vilket förslag som användes. Just det är vad ett underlag
 * behöver kunna visa — ett halvår senare, när någon undrar varför linjen ser
 * ut som den gör.
 *
 * Loggen ligger vid sidan av konfigurationen och inte i den. Den ska inte
 * kunna ångras bort: att ta tillbaka en ändring är också något som hände.
 */

export type LogKind =
  | "start"
  | "upload"
  | "ask"
  | "answer"
  | "job"
  | "proposal"
  | "machine"
  | "hall"
  | "draw"
  | "flow"
  | "share"
  | "quote";

export type LogEntry = {
  id: string;
  /** ISO-tid. */
  at: string;
  kind: LogKind;
  /** En rad, som den läses i listan. */
  text: string;
  /** Hela texten när den är lång: frågan, svaret, sammanfattningen. */
  detail?: string;
};

export const LOG_LIMIT = 400;

export const KIND_LABEL: Record<LogKind, string> = {
  start: "Start",
  upload: "Underlag",
  ask: "Fråga",
  answer: "Svar",
  job: "Jobb",
  proposal: "Förslag",
  machine: "Maskin",
  hall: "Hall",
  draw: "Ritat",
  flow: "Flöde",
  share: "Delning",
  quote: "Offert",
};

let counter = 0;
export function logEntry(kind: LogKind, text: string, detail?: string): LogEntry {
  counter += 1;
  return {
    id: `${Date.now().toString(36)}-${counter.toString(36)}`,
    at: new Date().toISOString(),
    kind,
    text,
    ...(detail ? { detail: detail.slice(0, 4000) } : {}),
  };
}

const m = (mm: number) => meters(mm);

/**
 * Vad som ändrades mellan två tillstånd.
 *
 * Loggen skrivs på ett ställe — där konfigurationen byts ut — i stället för i
 * varje knapp. Det gör att ingenting kan glömmas bort när en ny knapp läggs
 * till, och att raderna beskriver verkliga skillnader i stället för avsikter.
 */
export function describeChange(
  before: Configuration,
  after: Configuration,
  nameOf: (machineId: string) => string,
): LogEntry | null {
  if (before.line.length !== after.line.length) {
    const added = after.line.filter(
      (item) => !before.line.some((old) => old.instanceId === item.instanceId),
    );
    const removed = before.line.filter(
      (item) => !after.line.some((next) => next.instanceId === item.instanceId),
    );
    if (added.length === 1 && removed.length === 0) {
      return logEntry("machine", `La till ${nameOf(added[0].machineId)}`);
    }
    if (removed.length === 1 && added.length === 0) {
      return logEntry("machine", `Tog bort ${nameOf(removed[0].machineId)}`);
    }
    return logEntry(
      "machine",
      `Linjen ändrades: ${before.line.length} → ${after.line.length} maskiner`,
    );
  }

  const hallBefore = before.hall;
  const hallAfter = after.hall;
  if (
    hallBefore.lengthMm !== hallAfter.lengthMm ||
    hallBefore.widthMm !== hallAfter.widthMm ||
    hallBefore.clearHeightMm !== hallAfter.clearHeightMm
  ) {
    return logEntry(
      "hall",
      `Hallen ändrades till ${m(hallAfter.lengthMm)} × ${m(hallAfter.widthMm)} m, ` +
        `fri höjd ${m(hallAfter.clearHeightMm)} m`,
    );
  }

  if (before.drawn.length !== after.drawn.length) {
    const added = after.drawn.filter((o) => !before.drawn.some((old) => old.id === o.id));
    if (added.length === 1) return logEntry("draw", `Ritade ${added[0].name}`);
    const removed = before.drawn.filter((o) => !after.drawn.some((next) => next.id === o.id));
    if (removed.length === 1) return logEntry("draw", `Tog bort ${removed[0].name}`);
    return logEntry("draw", `Ritningen ändrades: ${after.drawn.length} objekt`);
  }

  const flowChanges = (Object.keys(after.flow) as (keyof Configuration["flow"])[])
    .filter((key) => JSON.stringify(before.flow[key]) !== JSON.stringify(after.flow[key]))
    .filter((key) => key !== "startPoint" && key !== "endPoint");
  if (flowChanges.length > 0) {
    return logEntry(
      "flow",
      flowChanges.map((key) => `${FLOW_LABEL[key] ?? key}: ${format(after.flow[key])}`).join(", "),
    );
  }

  return null;
}

const FLOW_LABEL: Partial<Record<keyof Configuration["flow"], string>> = {
  infeedFrom: "Paketen kommer in",
  controlDeskSide: "Pulpetens sida",
  stickerMagazineSide: "Ströfacksmagasinets sida",
  truckPickupSide: "Truckens hämtsida",
  finalConveyorLengthMm: "Sista transportörens längd",
  fitToEndPoint: "Passa in mot slutpunkt",
};

const VALUE_LABEL: Record<string, string> = {
  straight: "rakt",
  right: "höger",
  left: "vänster",
  true: "på",
  false: "av",
};

function format(value: unknown): string {
  if (typeof value === "number") return `${m(value)} m`;
  return VALUE_LABEL[String(value)] ?? String(value);
}

/** Loggen som text, för den som vill klistra in den i ett underlag. */
export function logAsText(entries: LogEntry[], projectName: string): string {
  const lines = [`Projektlogg — ${projectName}`, ""];
  for (const entry of entries) {
    lines.push(`${new Date(entry.at).toLocaleString("sv-SE")}  [${KIND_LABEL[entry.kind]}] ${entry.text}`);
    if (entry.detail) {
      for (const line of entry.detail.split("\n")) lines.push(`    ${line}`);
    }
  }
  return lines.join("\n");
}
