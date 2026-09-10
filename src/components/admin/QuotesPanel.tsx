"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { applyAdjustment, type QuoteAdjustment } from "@/lib/quoteAdjustment";
import { Button, Tag } from "../ui";
import { Panel } from "./fields";

/**
 * Alla offerter, i en vy.
 *
 * Kundens egen lista rör bara henne. Det här är INKAB:s: vem som håller på med
 * vad, vad det ligger på, var det står — och möjligheten att sätta rabatten på
 * en enskild affär utan att flytta prisboken för alla andra.
 */

type Status = "draft" | "sent" | "won" | "lost";

type Row = {
  id: string;
  name: string;
  reference: string;
  status: Status;
  adjustment: QuoteAdjustment;
  updatedAt: string;
  ownerEmail: string | null;
  ownerName: string | null;
  projectName: string;
  customer: { company?: string; contact?: string; site?: string } | null;
  machineCount: number;
  totalLengthMm: number;
  errorCount: number;
  warningCount: number;
  listSek: number;
  finalSek: number;
  logCount: number;
};

const STATUS_LABEL: Record<Status, string> = {
  draft: "Utkast",
  sent: "Skickad",
  won: "Vunnen",
  lost: "Förlorad",
};

const STATUS_TONE: Record<Status, "muted" | "accent" | "warn" | "danger"> = {
  draft: "muted",
  sent: "accent",
  won: "accent",
  lost: "warn",
};

const sek = (value: number) => `${Math.round(value).toLocaleString("sv-SE")} kr`;

export function QuotesPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/proposals");
      if (!response.ok) {
        setError("Kunde inte läsa offerterna.");
        return;
      }
      const body = await response.json();
      setRows(body.proposals ?? []);
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

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== "all" && row.status !== filter) return false;
      if (!needle) return true;
      return [
        row.name,
        row.reference,
        row.projectName,
        row.ownerEmail ?? "",
        row.ownerName ?? "",
        row.customer?.company ?? "",
        row.customer?.contact ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, filter, query]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    const response = await fetch("/api/admin/proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      setError(result?.error ?? `Servern svarade ${response.status}.`);
      return;
    }
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...result.proposal } : row)),
    );
    setError(null);
  };

  const remove = async (id: string) => {
    await fetch(`/api/admin/proposals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const totals = useMemo(
    () => ({
      count: shown.length,
      value: shown.reduce((sum, row) => sum + row.finalSek, 0),
      won: shown.filter((row) => row.status === "won").reduce((sum, row) => sum + row.finalSek, 0),
    }),
    [shown],
  );

  return (
    <Panel
      title="Offerter"
      description="Alla kunders sparade underlag, med pris och läge."
      action={
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? "Läser…" : "Uppdatera"}
        </Button>
      }
    >
      {error ? (
        <p className="mb-3 border border-danger px-2 py-1 text-xs text-danger">{error}</p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök kund, projekt eller underlag…"
          className="w-[260px] border border-divider px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <div className="flex gap-1">
          {(["all", "draft", "sent", "won", "lost"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`kicker border px-2 py-1 ${
                filter === value ? "border-accent bg-accent text-white" : "border-divider"
              }`}
            >
              {value === "all" ? "Alla" : STATUS_LABEL[value]}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-muted">
          {totals.count} offerter · summa <span className="num">{sek(totals.value)}</span>
          {totals.won > 0 ? (
            <>
              {" "}
              · vunnet <span className="num">{sek(totals.won)}</span>
            </>
          ) : null}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-muted">
          {rows.length === 0
            ? "Inga sparade offerter än. En kund som sparar ett förslag hamnar här."
            : "Ingen offert matchar filtret."}
        </p>
      ) : (
        <ul className="text-xs">
          {shown.map((row) => (
            <li key={row.id} className="border-t border-divider py-2 first:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Tag>
                <span className="text-[13px]">{row.name}</span>
                <span className="num text-muted">{row.reference}</span>
                <span className="text-muted">
                  {row.ownerName || row.ownerEmail || "utan konto"}
                  {row.customer?.company ? ` · ${row.customer.company}` : ""}
                </span>
                <span className="num ml-auto">
                  {row.finalSek !== row.listSek ? (
                    <>
                      <span className="text-muted line-through">{sek(row.listSek)}</span>{" "}
                      <span className="text-accent">{sek(row.finalSek)}</span>
                    </>
                  ) : (
                    sek(row.finalSek)
                  )}
                </span>
                <button
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                  className="text-accent hover:underline"
                >
                  {open === row.id ? "Dölj" : "Öppna"}
                </button>
              </div>

              <div className="mt-1 text-muted">
                {new Date(row.updatedAt).toLocaleString("sv-SE")} · {row.machineCount} maskiner ·{" "}
                {(row.totalLengthMm / 1000).toFixed(1).replace(".", ",")} m
                {row.errorCount > 0 ? ` · ${row.errorCount} fel` : ""}
                {row.warningCount > 0 ? ` · ${row.warningCount} varningar` : ""}
                {row.logCount > 0 ? ` · ${row.logCount} händelser i historiken` : ""}
              </div>

              {open === row.id ? (
                <QuoteEditor
                  row={row}
                  onPatch={(body) => patch(row.id, body)}
                  onRemove={() => remove(row.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Det som hör till affären: läge, rabatt och vägen in i konfiguratorn. */
function QuoteEditor({
  row,
  onPatch,
  onRemove,
}: {
  row: Row;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onRemove: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [discount, setDiscount] = useState(String(row.adjustment.discountPercent ?? ""));
  const [fixed, setFixed] = useState(String(row.adjustment.fixedTotalSek ?? ""));
  const [note, setNote] = useState(row.adjustment.note ?? "");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const number = (value: string) => {
    const parsed = Number(value.replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  const preview = applyAdjustment(row.listSek, {
    discountPercent: number(discount),
    fixedTotalSek: number(fixed),
    note,
  });

  const save = async () => {
    setBusy(true);
    await onPatch({
      name,
      adjustment: {
        discountPercent: number(discount),
        fixedTotalSek: number(fixed),
        note: note.trim() || undefined,
      },
    });
    setBusy(false);
  };

  return (
    <div className="mt-2 border border-divider bg-paper p-3">
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="kicker mb-1 block">Namn</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="kicker mb-1 block">Avdrag %</span>
          <input
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            placeholder="0"
            className="num w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="kicker mb-1 block">Avtalat totalpris</span>
          <input
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
            placeholder="—"
            className="num w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>

      <label className="mb-3 block">
        <span className="kicker mb-1 block">Notering till offerten</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="T.ex. Ramavtal 2026, 5 % på maskiner."
          className="w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
        />
      </label>

      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        Listpris <span className="num">{sek(preview.listSek)}</span> ·{" "}
        {preview.applied ? (
          <>
            att betala <span className="num text-accent">{sek(preview.finalSek)}</span>, avdrag{" "}
            <span className="num">{sek(preview.deltaSek)}</span>
          </>
        ) : (
          "ingen justering"
        )}
        . Ett avtalat totalpris går före avdraget. Justeringen gäller bara den här offerten och
        rör inte prisboken.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={save}>
          {busy ? "Sparar…" : "Spara"}
        </Button>

        <select
          value={row.status}
          onChange={(e) => onPatch({ status: e.target.value })}
          className="border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
        >
          {(Object.keys(STATUS_LABEL) as Status[]).map((value) => (
            <option key={value} value={value}>
              {STATUS_LABEL[value]}
            </option>
          ))}
        </select>

        <a
          href={`/?offert=${encodeURIComponent(row.id)}`}
          className="inline-flex items-center border border-divider px-3 py-1.5 text-sm hover:border-accent hover:bg-accent hover:text-white"
        >
          Öppna i konfiguratorn
        </a>

        {confirm ? (
          <>
            <Button size="sm" variant="primary" onClick={onRemove}>
              Ja, ta bort
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Avbryt
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirm(true)}>
            Ta bort
          </Button>
        )}
      </div>
    </div>
  );
}
