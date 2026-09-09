"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { quoteReference } from "@/lib/quote";
import { Button } from "./ui";
import type { Configuration } from "@/lib/types";

/**
 * Sparade förslag.
 *
 * En konfiguration lever annars bara i webbläsaren och i delningslänken. Det
 * räcker för att skicka något vidare, men inte för att komma tillbaka till
 * det man höll på med — och en säljare som jobbar på tre varianter samtidigt
 * behöver dem åtskilda och namngivna.
 */

type Item = {
  id: string;
  name: string;
  reference: string;
  updatedAt: string;
};

export function ProposalDialog({ onClose }: { onClose: () => void }) {
  const { config, load, log, setLog, note: writeLog } = useConfigStore();
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState(config.projectName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/proposals");
      if (response.status === 401) {
        setError("Logga in för att spara förslag.");
        return;
      }
      const body = (await response.json()) as { proposals: Item[] };
      setItems(body.proposals ?? []);
      setError(null);
    } catch {
      setError("Kunde inte hämta dina förslag.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config, log }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        setError(body?.error ?? `Servern svarade ${response.status}.`);
        return;
      }
      writeLog("proposal", `Sparade förslaget "${name}"`);
      setNote(
        body.persisted
          ? "Sparat."
          : `Sparat för den här serverinstansen. ${body.reason ?? ""} Det försvinner vid omstart.`,
      );
      refresh();
    } catch {
      setError("Nätverket svarade inte.");
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string) => {
    const response = await fetch(`/api/proposals?id=${encodeURIComponent(id)}`);
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.proposal) {
      setError("Förslaget gick inte att öppna.");
      return;
    }
    load(body.proposal.config as Configuration, {
      resetHistory: true,
      note: `Öppnade det sparade förslaget "${body.proposal.name}"`,
    });
    // Historiken hör till förslaget: den som öppnar det ska se hur det blev
    // till, inte den förra kundens spår.
    if (Array.isArray(body.proposal.log)) setLog(body.proposal.log);
    onClose();
  };

  const remove = async (id: string) => {
    await fetch(`/api/proposals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-lg border border-divider bg-white p-4 text-ink shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="kicker">Mina förslag</h2>
          <button onClick={onClose} className="ml-auto text-muted hover:text-ink" aria-label="Stäng">
            ×
          </button>
        </div>

        {error ? (
          <p className="mb-3 border border-danger px-2 py-1 text-xs text-danger">{error}</p>
        ) : null}
        {note ? (
          <p className="mb-3 border border-accent px-2 py-1 text-xs text-accent">{note}</p>
        ) : null}

        <div className="mb-4 flex items-end gap-2">
          <label className="flex-1">
            <span className="kicker mb-1 block">Spara det här förslaget som</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-divider px-2 py-1 text-sm outline-none focus:border-accent"
            />
          </label>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Sparar…" : "Spara"}
          </Button>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-muted">
          Underlag <span className="num">{quoteReference(config)}</span>. Sparar du med ett namn
          som redan finns läggs det till som ett nytt förslag — namnet är en etikett, inte en
          nyckel.
        </p>

        {items.length === 0 ? (
          <p className="border border-dashed border-divider px-3 py-4 text-xs text-muted">
            Inga sparade förslag än.
          </p>
        ) : (
          <ul className="scroll-thin max-h-64 overflow-y-auto text-sm">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 border-t border-divider py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.name}</div>
                  <div className="kicker truncate">
                    {item.reference} · {item.updatedAt.slice(0, 10)}
                  </div>
                </div>
                <Button size="sm" onClick={() => open(item.id)}>
                  Öppna
                </Button>
                <button
                  onClick={() => remove(item.id)}
                  className="text-muted hover:text-danger"
                  aria-label="Ta bort"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
