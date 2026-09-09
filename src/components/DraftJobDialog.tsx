"use client";

import { useRef, useState } from "react";
import { ACCEPTED, MAX_ATTACHMENTS, toAttachment, type Attachment } from "@/lib/attachments";
import { rememberJob } from "@/lib/draftJobClient";
import { Button } from "./ui";
import type { Configuration } from "@/lib/types";

/**
 * "Har du en ritning?"
 *
 * Frågan ställs en gång, när kunden väljer att bygga från grunden. Laddar hon
 * upp något går det till assistenten som ett bakgrundsjobb och hon får börja
 * rita direkt — beskedet kommer när förslaget står. Vill hon inte det stänger
 * hon dialogen och ritar själv, precis som förut.
 */

export function DraftJobDialog({
  config,
  onQueued,
  onSkip,
}: {
  config: Configuration;
  onQueued: () => void;
  onSkip: () => void;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const attach = async (chosen: FileList | null) => {
    if (!chosen?.length) return;
    setReading(true);
    setError(null);
    const added: Attachment[] = [];
    const problems: string[] = [];
    for (const file of Array.from(chosen).slice(0, MAX_ATTACHMENTS)) {
      try {
        added.push(await toAttachment(file));
      } catch (problem) {
        problems.push(problem instanceof Error ? problem.message : `${file.name} gick inte att läsa.`);
      }
    }
    setFiles((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));
    if (problems.length) setError(problems.join(" · "));
    setReading(false);
    if (input.current) input.current.value = "";
  };

  const send = async () => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          note,
          attachments: files.map((f) => ({ name: f.name, mediaType: f.mediaType, data: f.data })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.job?.id) {
        setError(body?.error ?? `Servern svarade ${response.status}.`);
        return;
      }
      rememberJob(body.job.id);
      onQueued();
    } catch {
      setError("Nätverket svarade inte. Prova igen, eller rita för hand så länge.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-xl border border-divider bg-white p-5 text-ink shadow-xl">
        <div className="kicker mb-2">Innan du börjar</div>
        <h2 className="mb-2 text-xl leading-tight">Har du en ritning eller en skiss?</h2>
        <p className="mb-4 text-sm leading-relaxed text-muted">
          Ladda upp en ritning över lokalen eller en bild på tänkt flöde, så bygger assistenten ett
          förslag åt dig. Det tar några minuter och sker i bakgrunden — du kan rita och lägga till
          maskiner under tiden, och får besked här i verktyget när förslaget står.
        </p>

        {error ? (
          <p className="mb-3 border border-danger px-2 py-1 text-xs text-danger">{error}</p>
        ) : null}

        <input
          ref={input}
          type="file"
          accept={ACCEPTED}
          multiple
          onChange={(e) => attach(e.target.files)}
          className="hidden"
          aria-label="Välj ritning eller bild"
        />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={reading || busy || files.length >= MAX_ATTACHMENTS}
            onClick={() => input.current?.click()}
          >
            {reading ? "Läser…" : files.length ? "Lägg till fler" : "Välj filer"}
          </Button>
          <span className="text-[11px] text-muted">
            png, jpg eller pdf · max {MAX_ATTACHMENTS} filer
          </span>
        </div>

        {files.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {files.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 border border-divider px-2 py-1 text-[11px]"
              >
                {file.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.previewUrl} alt="" className="h-8 w-8 object-cover" />
                ) : (
                  <span className="kicker text-muted">PDF</span>
                )}
                <span className="max-w-[180px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Ta bort ${file.name}`}
                  className="px-1 text-muted hover:text-danger"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <label className="mb-4 block">
          <span className="kicker mb-1 block">Vad ska anläggningen göra? (frivilligt)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="T.ex. 18 paket i timmen, truckströläggning, hallen är 48 m lång."
            className="w-full border border-divider px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <span className="mt-1 block text-[11px] leading-relaxed text-muted">
            Skriv gärna ett känt mått. Utan skala kan en ritning inte mätas, och då säger
            assistenten till i stället för att gissa.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || files.length === 0} onClick={send}>
            {busy ? "Skickar…" : "Skicka in och börja rita"}
          </Button>
          <Button variant="ghost" onClick={onSkip}>
            Nej tack — jag ritar själv
          </Button>
        </div>
      </div>
    </div>
  );
}
