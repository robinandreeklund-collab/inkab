"use client";

import { useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { computeLayout } from "@/lib/layout";
import { meters } from "@/lib/format";
import { Button, Tag } from "./ui";
import type { Configuration } from "@/lib/types";

type Variant = { id: string; name: string; description: string; config: Configuration };
type ChatTurn = { role: "user" | "assistant"; content: string };

const PROMPTS = [
  "Optimera layouten så att den blir kortare",
  "Varför får jag varningarna?",
  "Vad händer om trucken kommer från andra hållet?",
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
  const historyRef = useRef<ChatTurn[]>([]);

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    setThinking("");
    setVariants([]);
    setPreview(null);
    setInput("");
    toggleAi(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, message: question, history: historyRef.current.slice(-8) }),
      });
      if (!response.ok || !response.body) throw new Error("Assistenten svarade inte.");

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
        { role: "user", content: question },
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
      {text ? <p className="mb-3 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed">{text}</p> : null}
      {busy && !text ? <p className="mb-3 text-sm text-muted">Tänker…</p> : null}

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

      {!busy && variants.length === 0 && !text ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {PROMPTS.map((prompt) => (
            <Button key={prompt} size="sm" onClick={() => send(prompt)}>
              {prompt}
            </Button>
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Fråga om placering, kapacitet eller pris…"
          className="flex-1 border border-divider px-3 py-2 text-sm outline-none focus:border-accent"
        />
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
