"use client";

import { useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { computeLayout } from "@/lib/layout";
import { meters } from "@/lib/format";
import { Button, Tag } from "./ui";
import {
  ACCEPTED,
  MAX_ATTACHMENTS,
  toAttachment,
  type Attachment,
} from "@/lib/attachments";
import { rememberJob } from "@/lib/draftJobClient";
import type { Configuration } from "@/lib/types";

type Variant = { id: string; name: string; description: string; config: Configuration };
type ChatTurn = { role: "user" | "assistant"; content: string };

const PROMPTS = [
  "Optimera layouten så att den blir kortare",
  "Varför får jag varningarna?",
  "Vad händer om trucken kommer från andra hållet?",
];

/** Vad man rimligen vill göra med en uppladdad ritning eller skiss. */
const FILE_PROMPTS = [
  "Rita upp lokalen efter den här ritningen",
  "Bygg linjen efter det här flödet",
  "Vad ser du på bilden?",
];

export function AiPanel() {
  const { config, layout, aiOpen, toggleAi, load } = useConfigStore();

  const [input, setInput] = useState("");
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [preview, setPreview] = useState<Variant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const [queued, setQueued] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const historyRef = useRef<ChatTurn[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Att läsa en ritning tar minuter. En sekundräknare säger mer om att det
  // faktiskt pågår än en snurra gör.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  /* Samma underlag, men utan att någon behöver sitta och vänta på svaret. */
  const queue = async () => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          note: input,
          attachments: files.map((f) => ({ name: f.name, mediaType: f.mediaType, data: f.data })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.job?.id) {
        setError(body?.error ?? `Servern svarade ${response.status}.`);
        return;
      }
      rememberJob(body.job.id);
      setFiles([]);
      setInput("");
      setQueued(true);
    } catch {
      setError("Nätverket svarade inte.");
    } finally {
      setBusy(false);
    }
  };

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
    if (fileInput.current) fileInput.current.value = "";
  };

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    setQueued(false);
    setText("");
    setThinking("");
    setVariants([]);
    setPreview(null);
    setInput("");
    toggleAi(true);
    // Bilagorna hör till frågan de skickas med och töms när den är skickad.
    const sent = files;
    setFiles([]);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          message: question,
          history: historyRef.current.slice(-8),
          attachments: sent.map((f) => ({ name: f.name, mediaType: f.mediaType, data: f.data })),
        }),
      });
      if (!response.ok) {
        // Visa serverns egna ord i stället för ett generiskt fel.
        const problem = await response.json().catch(() => null);
        setError(
          [problem?.error, ...(problem?.issues ?? [])].filter(Boolean).join(" · ") ||
            `Servern svarade ${response.status}.`,
        );
        return;
      }
      if (!response.body) throw new Error("Tomt svar.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const eventLine = chunk.match(/^event: (.+)$/m);
          const dataLine = chunk.match(/^data: (.+)$/m);
          if (!eventLine || !dataLine) continue;
          const payload = JSON.parse(dataLine[1]);

          switch (eventLine[1]) {
            case "thinking":
              setThinking((t) => (t + payload.text).slice(-220));
              break;
            case "text":
              answer += payload.text;
              setText(answer);
              break;
            case "tool":
              setActiveTool(payload.name);
              break;
            case "done":
              setVariants(payload.variants ?? []);
              setAiConfigured(payload.aiConfigured);
              setActiveTool(null);
              setThinking("");
              break;
            case "error":
              setError(payload.message);
              break;
          }
        }
      }

      const turns: ChatTurn[] = [
        {
          role: "user",
          content: sent.length
            ? `${question}\n(bifogade filer: ${sent.map((f) => f.name).join(", ")})`
            : question,
        },
        { role: "assistant", content: answer || "(inget svar)" },
      ];
      historyRef.current = [...historyRef.current, ...turns].slice(-8);
    } catch {
      setError("Assistenten är tillfälligt otillgänglig. Verktyget fungerar utan den.");
    } finally {
      setBusy(false);
      setActiveTool(null);
    }
  };

  if (!aiOpen) {
    return (
      <button
        onClick={() => toggleAi(true)}
        className="blueprint absolute bottom-4 left-1/2 flex w-[min(540px,88%)] -translate-x-1/2 items-center gap-3 bg-white px-3 py-2 text-left shadow-sm hover:border-accent"
      >
        <Sparkle />
        <span className="flex-1 text-sm text-muted">Fråga om placering, kapacitet eller pris…</span>
        {variants.length > 0 ? <Tag tone="accent">{variants.length} förslag</Tag> : null}
      </button>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-0 max-h-[62%] overflow-y-auto border-t border-divider bg-white p-3 shadow-[0_-6px_18px_rgba(0,0,0,0.06)]">
      <div className="mb-2 flex items-center gap-3">
        <Sparkle />
        <h2 className="kicker">Assistent</h2>
        {activeTool ? (
          <span className="truncate text-[11px] text-muted">Kör {toolLabel(activeTool)}…</span>
        ) : thinking ? (
          <span className="truncate text-[11px] text-muted">{thinking}</span>
        ) : null}
        {aiConfigured === false ? <Tag tone="warn">Ingen API-nyckel</Tag> : null}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => toggleAi(false)}>
          Fäll ihop ▾
        </Button>
      </div>

      {error ? <p className="mb-2 border border-danger px-3 py-2 text-xs text-danger">{error}</p> : null}
      {queued ? (
        <p className="mb-2 border border-accent px-3 py-2 text-xs text-accent">
          Underlaget är inskickat. Du får besked uppe till vänster när förslaget står — rita
          vidare under tiden.
        </p>
      ) : null}
      {text ? <p className="mb-3 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed">{text}</p> : null}
      {busy && !text ? (
        <p className="mb-3 text-sm text-muted">
          Tänker… <span className="num">{elapsed} s</span>
          {elapsed > 45 ? (
            <span className="block text-xs">
              Underlag tar tid att läsa. Nästa gång kan du välja Bygg i bakgrunden och rita vidare
              under tiden.
            </span>
          ) : null}
        </p>
      ) : null}

      {variants.length > 0 ? (
        <div className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {variants.map((variant) => (
            <VariantCard
              key={variant.id}
              variant={variant}
              current={config}
              previewing={preview?.id === variant.id}
              onPreview={() => {
                if (preview?.id === variant.id) {
                  load(config, { resetHistory: false });
                  setPreview(null);
                } else {
                  setPreview(variant);
                }
              }}
              onApply={() => {
                load(variant.config);
                setPreview(null);
                toggleAi(false);
              }}
            />
          ))}
        </div>
      ) : null}

      {!busy && (files.length > 0 || (variants.length === 0 && !text)) ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {(files.length > 0 ? FILE_PROMPTS : PROMPTS).map((prompt) => (
            <Button key={prompt} size="sm" onClick={() => send(prompt)}>
              {prompt}
            </Button>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
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
              <span className="num text-muted">{Math.max(1, Math.round(file.bytes / 1000))} kB</span>
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED}
          multiple
          onChange={(e) => attach(e.target.files)}
          className="hidden"
          aria-label="Bifoga ritning eller bild"
        />
        <Button
          type="button"
          size="sm"
          title="Bifoga ritning över lokalen eller bild på flödet (png, jpg, pdf)"
          disabled={busy || reading || files.length >= MAX_ATTACHMENTS}
          onClick={() => fileInput.current?.click()}
          className="px-3"
        >
          {reading ? "Läser…" : "Bifoga"}
        </Button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            files.length
              ? "Vad ska jag göra med filen?"
              : "Fråga om placering, kapacitet eller pris…"
          }
          className="flex-1 border border-divider px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {files.length > 0 ? (
          <Button
            type="button"
            title="Assistenten arbetar i bakgrunden och säger till när förslaget står"
            disabled={busy}
            onClick={queue}
          >
            Bygg i bakgrunden
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={busy || !input.trim()}>
          {busy ? "Arbetar…" : "Skicka"}
        </Button>
      </form>

      {preview ? (
        <p className="mt-2 text-[11px] text-muted">
          Förhandsgranskar “{preview.name}”. Klicka Förhandsgranska igen för att gå tillbaka.
        </p>
      ) : null}
    </div>
  );
}

function VariantCard({
  variant,
  current,
  previewing,
  onPreview,
  onApply,
}: {
  variant: Variant;
  current: Configuration;
  previewing: boolean;
  onPreview: () => void;
  onApply: () => void;
}) {
  const before = computeLayout(current);
  const after = computeLayout(variant.config);

  const diff = (a: number, b: number, unit: string) =>
    a === b ? `Oförändrat (${a}${unit})` : `${a}${unit} → ${b}${unit}`;

  const errorsBefore = before.diagnostics.filter((d) => d.severity === "error").length;
  const errorsAfter = after.diagnostics.filter((d) => d.severity === "error").length;
  const warnBefore = before.diagnostics.filter((d) => d.severity === "warning").length;
  const warnAfter = after.diagnostics.filter((d) => d.severity === "warning").length;

  return (
    <div className={`blueprint p-3 ${previewing ? "border-accent" : ""}`}>
      <div className="kicker">{variant.id.toUpperCase()}</div>
      <h3 className="mb-1 text-[15px] leading-tight">{variant.name}</h3>
      <p className="mb-2 text-xs leading-relaxed text-muted">{variant.description}</p>

      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <span className="num">
          Längd{" "}
          {diff(
            Number(meters(before.metrics.totalLengthMm)),
            Number(meters(after.metrics.totalLengthMm)),
            " m",
          )}
        </span>
        <span className="num">
          Kapacitet {diff(before.metrics.throughputPerHour, after.metrics.throughputPerHour, " pkt/h")}
        </span>
        <span className={errorsAfter + warnAfter < errorsBefore + warnBefore ? "text-accent" : ""}>
          Anmärkningar {errorsBefore + warnBefore} → {errorsAfter + warnAfter}
        </span>
      </div>

      <div className="flex gap-2">
        <Button size="sm" active={previewing} onClick={onPreview}>
          {previewing ? "Visar" : "Förhandsgranska"}
        </Button>
        <Button size="sm" variant="primary" onClick={onApply}>
          Använd
        </Button>
      </div>
    </div>
  );
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    get_machine_library: "maskinbiblioteket",
    get_current_layout: "layoutkontroll",
    set_flow: "flödesändring",
    add_machine: "lägger till maskin",
    remove_machine: "tar bort maskin",
    set_hall: "hallmått",
    estimate_price: "prisberäkning",
    clear_line: "tömmer linjen",
    draw_hall: "ritar upp lokalen",
    propose_variant: "sparar förslag",
  };
  return labels[name] ?? name;
}

function Sparkle() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5980a6" strokeWidth="1.5">
      <path d="M12 3 13.9 8.1 19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M18 16.5 18.8 18.7 21 19.5l-2.2.8L18 22.5l-.8-2.2-2.2-.8 2.2-.8z" />
    </svg>
  );
}
