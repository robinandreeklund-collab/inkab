"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DOCUMENT_KIND_LABEL,
  formatBytes,
  guessKind,
  MAX_DOCUMENT_BYTES,
  ORDER_STATE_LABEL,
  ORDERED_KINDS,
  type DocumentKind,
  type MachineDocument,
  type OrderState,
} from "@/lib/documents";
import { Button, Tag } from "../ui";
import { Panel } from "./fields";

/**
 * Maskinens underlag.
 *
 * Ritningen, STEP-modellen, balklistan, skärfilerna som ska till
 * legotillverkaren. De hör till maskinen och inte till en mapp på någons dator,
 * och den som ska bygga ska slippa leta. Skärfiler och balklistor bär dessutom
 * sitt beställningsläge: att en fil finns i systemet betyder inte att den är
 * beställd.
 */

const ORDER_TONE: Record<OrderState, "muted" | "accent" | "warn"> = {
  none: "muted",
  needed: "warn",
  ordered: "accent",
  received: "accent",
};

export function DocumentPanel({ machineId }: { machineId: string }) {
  const [documents, setDocuments] = useState<MachineDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/admin/documents?machineId=${encodeURIComponent(machineId)}`,
    );
    if (!response.ok) {
      setError("Kunde inte läsa underlagen.");
      return;
    }
    const body = await response.json();
    setDocuments(body.documents ?? []);
    setError(null);
  }, [machineId]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setNote(null);

    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("machineId", machineId);
      form.set("file", file);
      // Sorten gissas ur filnamnet och går att ändra efteråt.
      form.set("kind", guessKind(file.name));
      if (ORDERED_KINDS.includes(guessKind(file.name))) form.set("orderState", "needed");

      const response = await fetch("/api/admin/documents", { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        setError(body?.error ?? `${file.name}: servern svarade ${response.status}.`);
        continue;
      }
      if (!body.persisted) {
        setNote(`Sparat i minnet. ${body.reason ?? ""} Filen försvinner vid omstart.`);
      }
    }

    setBusy(false);
    if (input.current) input.current.value = "";
    load();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const response = await fetch("/api/admin/documents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      setError(result?.error ?? `Servern svarade ${response.status}.`);
      return;
    }
    setDocuments((current) => current.map((d) => (d.id === id ? result.document : d)));
  };

  const remove = async (id: string) => {
    await fetch(`/api/admin/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setDocuments((current) => current.filter((d) => d.id !== id));
  };

  const toOrder = documents.filter((d) => d.orderState === "needed");

  return (
    <Panel
      title="Underlag"
      description="Ritningar, STEP, balklistor och skärfiler som hör till maskinen."
      action={
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Laddar upp…" : "Ladda upp"}
        </Button>
      }
    >
      <input
        ref={input}
        type="file"
        multiple
        onChange={(e) => upload(e.target.files)}
        className="hidden"
        aria-label="Välj underlag"
      />

      {error ? (
        <p className="mb-3 border border-danger px-2 py-1 text-xs text-danger">{error}</p>
      ) : null}
      {note ? (
        <p className="mb-3 border border-warn px-2 py-1 text-xs text-warn">{note}</p>
      ) : null}
      {toOrder.length > 0 ? (
        <p className="mb-3 border border-warn px-2 py-1 text-xs text-warn">
          {toOrder.length} underlag är märkta som ska beställas:{" "}
          {toOrder.map((d) => d.title || d.name).join(", ")}.
        </p>
      ) : null}

      {documents.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted">
          Inga underlag än. Lägg in ritningar, STEP-filer, balklistor och skärfiler här — de
          följer maskinen i stället för att ligga i en mapp. Max{" "}
          {MAX_DOCUMENT_BYTES / 1e6} MB per fil.
        </p>
      ) : (
        <ul className="text-xs">
          {documents.map((document) => (
            <li key={document.id} className="border-t border-divider py-1.5 first:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <Tag>{DOCUMENT_KIND_LABEL[document.kind]}</Tag>
                <a
                  href={`/api/documents/${document.id}`}
                  className="text-[13px] text-accent hover:underline"
                >
                  {document.title || document.name}
                </a>
                {document.revision ? (
                  <span className="num text-muted">rev {document.revision}</span>
                ) : null}
                {document.orderState !== "none" ? (
                  <Tag tone={ORDER_TONE[document.orderState]}>
                    {ORDER_STATE_LABEL[document.orderState]}
                    {document.supplier ? ` · ${document.supplier}` : ""}
                  </Tag>
                ) : null}
                <span className="num ml-auto text-muted">{formatBytes(document.bytes)}</span>
                <button
                  onClick={() => setOpen(open === document.id ? null : document.id)}
                  className="text-accent hover:underline"
                >
                  {open === document.id ? "Dölj" : "Ändra"}
                </button>
              </div>

              <div className="text-muted">
                {document.name} · {new Date(document.createdAt).toLocaleDateString("sv-SE")}
                {document.uploadedBy ? ` · ${document.uploadedBy}` : ""}
                {document.note ? ` · ${document.note}` : ""}
              </div>

              {open === document.id ? (
                <DocumentEditor
                  document={document}
                  onPatch={(body) => patch(document.id, body)}
                  onRemove={() => remove(document.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DocumentEditor({
  document,
  onPatch,
  onRemove,
}: {
  document: MachineDocument;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [revision, setRevision] = useState(document.revision);
  const [supplier, setSupplier] = useState(document.supplier);
  const [note, setNote] = useState(document.note);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="mt-2 border border-divider bg-paper p-2">
      <div className="mb-2 grid gap-2 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="kicker mb-1 block">Vad det är</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={document.name}
            className="w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="kicker mb-1 block">Revision</span>
          <input
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
            className="num w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="kicker mb-1 block">Sort</span>
          <select
            value={document.kind}
            onChange={(e) => onPatch({ kind: e.target.value })}
            className="w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          >
            {(Object.keys(DOCUMENT_KIND_LABEL) as DocumentKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {DOCUMENT_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-2 grid gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="kicker mb-1 block">Beställning</span>
          <select
            value={document.orderState}
            onChange={(e) => onPatch({ orderState: e.target.value })}
            className="w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          >
            {(Object.keys(ORDER_STATE_LABEL) as OrderState[]).map((state) => (
              <option key={state} value={state}>
                {ORDER_STATE_LABEL[state]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="kicker mb-1 block">Leverantör</span>
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Legotillverkare"
            className="w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="kicker mb-1 block">Notering</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => onPatch({ title, revision, supplier, note })}>
          Spara
        </Button>
        <a
          href={`/api/documents/${document.id}`}
          className="inline-flex items-center border border-divider px-3 py-1.5 text-sm hover:border-accent hover:bg-accent hover:text-white"
        >
          Ladda ner
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
