"use client";

import { useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { KIND_LABEL, logAsText, type LogEntry } from "@/lib/projectLog";
import { Button, Tag } from "./ui";

/**
 * Projektets historik.
 *
 * Vad som hänt, i ordning: vilket underlag som laddades upp, vad kunden
 * frågade assistenten, vad den svarade, vilket förslag som användes, vad som
 * ändrades i linjen. En konfiguration visar läget; det här visar vägen dit,
 * och det är den som ska gå att svara på ett halvår senare.
 */

const TONE: Partial<Record<LogEntry["kind"], "accent" | "warn" | "muted">> = {
  upload: "accent",
  ask: "accent",
  answer: "accent",
  job: "accent",
  proposal: "accent",
};

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const { log, config, clearLog } = useConfigStore();
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const entries = [...log].reverse();

  const copy = async () => {
    const text = logAsText(log, config.projectName);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Kopiera historiken:", text);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col border border-divider bg-white text-ink shadow-xl">
        <div className="flex items-center gap-2 border-b border-divider px-4 py-3">
          <h2 className="kicker">Historik</h2>
          <span className="text-[11px] text-muted">{log.length} händelser</span>
          <button onClick={onClose} className="ml-auto text-muted hover:text-ink" aria-label="Stäng">
            ×
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {entries.length === 0 ? (
            <p className="border border-dashed border-divider px-3 py-6 text-center text-xs text-muted">
              Inget har hänt i projektet än. Allt du gör härifrån hamnar i listan: uppladdade
              ritningar, frågor till assistenten, ändringar i linjen.
            </p>
          ) : (
            <ol className="space-y-1">
              {entries.map((entry) => (
                <li key={entry.id} className="border-b border-divider pb-1 last:border-0">
                  <div className="flex items-baseline gap-2">
                    <span className="num w-[118px] flex-none text-[11px] text-muted">
                      {new Date(entry.at).toLocaleString("sv-SE", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    <Tag tone={TONE[entry.kind] ?? "muted"}>{KIND_LABEL[entry.kind]}</Tag>
                    <span className="min-w-0 flex-1 text-sm leading-snug">{entry.text}</span>
                    {entry.detail ? (
                      <button
                        onClick={() => setOpen(open === entry.id ? null : entry.id)}
                        className="flex-none text-[11px] text-accent hover:underline"
                      >
                        {open === entry.id ? "Dölj" : "Visa"}
                      </button>
                    ) : null}
                  </div>
                  {open === entry.id && entry.detail ? (
                    <p className="ml-[130px] mt-1 whitespace-pre-wrap border-l border-divider pl-2 text-xs leading-relaxed text-muted">
                      {entry.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-divider px-4 py-3">
          <Button size="sm" onClick={copy} disabled={log.length === 0}>
            {copied ? "Kopierat" : "Kopiera som text"}
          </Button>
          {confirmClear ? (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  clearLog();
                  setConfirmClear(false);
                }}
              >
                Ja, töm historiken
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                Avbryt
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
              Töm
            </Button>
          )}
          <span className="ml-auto text-[11px] text-muted">
            Historiken ligger i den här webbläsaren och följer med när du sparar förslaget.
          </span>
        </div>
      </div>
    </div>
  );
}
