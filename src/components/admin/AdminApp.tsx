"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABEL } from "@/lib/library";
import { collectIssues, libraryDocumentSchema, type LibraryDocument } from "@/lib/machineSchema";
import { meters } from "@/lib/format";
import { Button, Tag, cx } from "../ui";
import { IssueList } from "./fields";
import { MachineForm } from "./MachineForm";
import { PriceBookForm } from "./PriceBookForm";
import { UserAdmin } from "./UserAdmin";
import type { StoreStatus } from "@/lib/server/store";
import type { PriceEntry } from "@/lib/server/pricebook";
import type { Machine, MachineCategory } from "@/lib/types";

type Issue = { path: string; message: string };

const EMPTY_PRICE: PriceEntry = { list: 0, cost: 0, options: {} };

function newMachine(existing: Machine[]): Machine {
  let n = existing.length + 1;
  while (existing.some((m) => m.id === `maskin-${n}`)) n += 1;
  return {
    id: `maskin-${n}`,
    sku: `NY-${n}`,
    name: "Ny maskin",
    category: "transport",
    summary: "",
    footprint: { lengthMm: 6000, widthMm: 2400, heightMm: 1200 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 1200 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 2400],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 6000, y: 1200 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 2400],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: false,
    zones: [],
    capacity: {
      packagesPerHour: 20,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1300],
      packageHeightMm: [500, 1400],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 4, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 20 },
    leadTimeWeeks: 14,
    options: [],
  };
}

export function AdminApp({ currentUserId, currentUserName }: { currentUserId: string; currentUserName: string }) {
  const [doc, setDoc] = useState<LibraryDocument | null>(null);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"machines" | "prices" | "users">("machines");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/library");
    if (!response.ok) {
      setMessage("Kunde inte läsa biblioteket.");
      return;
    }
    const data = await response.json();
    setDoc(data.document);
    setStatus(data.status);
    setSelectedId((current) => current ?? data.document.machines[0]?.id ?? null);
    setDirty(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Varna innan sidan lämnas med osparade ändringar.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = (recipe: (draft: LibraryDocument) => void) => {
    setDoc((current) => {
      if (!current) return current;
      const next: LibraryDocument = JSON.parse(JSON.stringify(current));
      recipe(next);
      return next;
    });
    setDirty(true);
    setMessage(null);
  };

  const selected = doc?.machines.find((m) => m.id === selectedId) ?? null;

  const grouped = useMemo(() => {
    const map = new Map<MachineCategory, Machine[]>();
    for (const machine of doc?.machines ?? []) {
      const list = map.get(machine.category) ?? [];
      list.push(machine);
      map.set(machine.category, list);
    }
    return map;
  }, [doc]);

  const save = async () => {
    if (!doc) return;
    setSaving(true);
    setIssues([]);
    setMessage(null);

    // Validera lokalt först så att felen pekar på rätt fält utan nätverksrunda.
    const local = libraryDocumentSchema.safeParse(doc);
    if (!local.success) {
      setIssues(collectIssues(local.error));
      setSaving(false);
      return;
    }

    const response = await fetch("/api/admin/library", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: doc }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      setIssues(data.issues ?? [{ path: "", message: data.error ?? "Sparningen misslyckades." }]);
      return;
    }

    setDirty(false);
    setStatus(data.status);
    setMessage(
      data.persisted
        ? "Sparat i databasen."
        : `Sparat för den här serverinstansen. ${data.reason ?? ""} Exportera JSON och committa den för att behålla ändringarna.`,
    );
  };

  const exportJson = () => {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "library.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    setIssues([]);
    try {
      const parsed = libraryDocumentSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) {
        setIssues(collectIssues(parsed.error));
        return;
      }
      setDoc(parsed.data as LibraryDocument);
      setSelectedId(parsed.data.machines[0]?.id ?? null);
      setDirty(true);
      setMessage("Filen är inläst. Spara för att aktivera den.");
    } catch {
      setIssues([{ path: "", message: "Filen är inte giltig JSON." }]);
    }
  };

  const reset = async () => {
    if (!window.confirm("Återställ till utgångsläget? Alla ändringar som inte exporterats går förlorade.")) {
      return;
    }
    const response = await fetch("/api/admin/library", { method: "DELETE" });
    if (response.ok) {
      const data = await response.json();
      setDoc(data.document);
      setStatus(data.status);
      setSelectedId(data.document.machines[0]?.id ?? null);
      setDirty(false);
      setMessage("Återställt till utgångsläget.");
    }
  };

  if (!doc) {
    return <div className="p-6 text-sm text-muted">Laddar biblioteket…</div>;
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-none flex-wrap items-center gap-3 border-b border-steel bg-steel px-3 py-2 text-paper">
        <a href="/" className="flex flex-none items-center">
          <Image src="/inkab-logo.png" alt="INKAB" width={459} height={96} className="h-5 w-auto" />
        </a>
        <span className="kicker text-paper/60">Admin</span>
        <span className="text-xs text-paper/80">{currentUserName}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirty ? <Tag tone="warn">Osparat</Tag> : null}
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importJson(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => fileInput.current?.click()}>
            Importera JSON
          </Button>
          <Button size="sm" onClick={exportJson}>
            Exportera JSON
          </Button>
          <Button size="sm" variant="ghost" onClick={reset}>
            Återställ
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Sparar…" : "Spara"}
          </Button>
          <a
            href="/"
            className="inline-flex items-center border border-paper/30 px-2 py-1 text-xs hover:border-accent hover:bg-accent"
          >
            Till konfiguratorn
          </a>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/";
            }}
            className="border border-paper/30 px-2 py-1 text-xs hover:border-accent hover:bg-accent"
          >
            Logga ut
          </button>
        </div>
      </header>

      <StatusBanner status={status} />

      <div className="flex min-h-0 flex-1">
        <nav className="scroll-thin w-[260px] flex-none overflow-y-auto border-r border-divider bg-white">
          <div className="flex border-b border-divider">
            {(
              [
                ["machines", `Maskiner (${doc.machines.length})`],
                ["prices", "Prisbok"],
                ["users", "Konton"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={cx(
                  "kicker flex-1 px-1.5 py-2 transition-colors",
                  tab === value ? "bg-accent text-white" : "hover:bg-paper",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "machines" ? (
            <div className="p-2">
              <Button
                size="sm"
                className="mb-2 w-full"
                onClick={() => {
                  const machine = newMachine(doc.machines);
                  update((d) => {
                    d.machines.push(machine);
                    d.priceBook.entries[machine.id] = { ...EMPTY_PRICE };
                  });
                  setSelectedId(machine.id);
                }}
              >
                + Ny maskin
              </Button>

              {[...grouped.entries()].map(([category, machines]) => (
                <div key={category} className="mb-2">
                  <div className="kicker px-1 py-1">{CATEGORY_LABEL[category]}</div>
                  {machines.map((machine) => (
                    <button
                      key={machine.id}
                      onClick={() => setSelectedId(machine.id)}
                      className={cx(
                        "block w-full border-b border-divider px-2 py-1.5 text-left last:border-0",
                        selectedId === machine.id ? "bg-accent/10" : "hover:bg-paper",
                      )}
                    >
                      <div className="truncate text-[13px]">{machine.name}</div>
                      <div className="kicker truncate">
                        {machine.sku} · {meters(machine.footprint.lengthMm)} m
                        {machine.aux ? " · hjälpobjekt" : ""}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </nav>

        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto p-4">
          {issues.length > 0 ? (
            <div className="mb-4">
              <p className="kicker mb-1 text-danger">Sparningen stoppades</p>
              <IssueList issues={issues} />
            </div>
          ) : null}
          {message ? (
            <p className="mb-4 border border-accent bg-white px-3 py-2 text-xs text-accent">
              {message}
            </p>
          ) : null}

          {tab === "users" ? (
            <UserAdmin currentUserId={currentUserId} />
          ) : tab === "prices" ? (
            <PriceBookForm
              priceBook={doc.priceBook}
              onChange={(priceBook) => update((d) => void (d.priceBook = priceBook))}
            />
          ) : selected ? (
            <MachineForm
              key={selected.id}
              machine={selected}
              price={doc.priceBook.entries[selected.id] ?? EMPTY_PRICE}
              allMachines={doc.machines}
              assets={doc.assets ?? []}
              onAssetsChange={(assets) => update((d) => void (d.assets = assets))}
              onChange={(machine) =>
                update((d) => {
                  const index = d.machines.findIndex((m) => m.id === selected.id);
                  if (index < 0) return;
                  d.machines[index] = machine;
                  // Följ med id-bytet så att pris och referenser inte tappas.
                  if (machine.id !== selected.id) {
                    d.priceBook.entries[machine.id] =
                      d.priceBook.entries[selected.id] ?? { ...EMPTY_PRICE };
                    delete d.priceBook.entries[selected.id];
                    for (const other of d.machines) {
                      other.requires = other.requires?.map((r) =>
                        r === selected.id ? machine.id : r,
                      );
                      other.conflictsWith = other.conflictsWith?.map((c) =>
                        c === selected.id ? machine.id : c,
                      );
                      if (other.anchorFor === selected.id) other.anchorFor = machine.id;
                    }
                    setSelectedId(machine.id);
                  }
                })
              }
              onPriceChange={(price) =>
                update((d) => void (d.priceBook.entries[selected.id] = price))
              }
              onDuplicate={() => {
                const copy: Machine = JSON.parse(JSON.stringify(selected));
                copy.id = `${selected.id}-kopia`;
                copy.sku = `${selected.sku}-K`;
                copy.name = `${selected.name} (kopia)`;
                update((d) => {
                  d.machines.push(copy);
                  d.priceBook.entries[copy.id] = {
                    ...(d.priceBook.entries[selected.id] ?? EMPTY_PRICE),
                  };
                });
                setSelectedId(copy.id);
              }}
              onDelete={() => {
                if (!window.confirm(`Ta bort ${selected.name}?`)) return;
                update((d) => {
                  d.machines = d.machines.filter((m) => m.id !== selected.id);
                  delete d.priceBook.entries[selected.id];
                  for (const other of d.machines) {
                    other.requires = other.requires?.filter((r) => r !== selected.id);
                    other.conflictsWith = other.conflictsWith?.filter((c) => c !== selected.id);
                    if (other.anchorFor === selected.id) other.anchorFor = undefined;
                  }
                });
                setSelectedId(doc.machines.find((m) => m.id !== selected.id)?.id ?? null);
              }}
            />
          ) : (
            <p className="text-sm text-muted">Ingen maskin vald.</p>
          )}
        </main>
      </div>
    </div>
  );
}

function StatusBanner({ status }: { status: StoreStatus | null }) {
  if (!status) return null;

  const tone = status.persistent ? "border-accent text-accent" : "border-warn text-warn";

  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-white px-3 py-1.5 text-[11px]", tone)}>
      <span>
        <strong>Lagring:</strong>{" "}
        {status.persistent
          ? "Postgres. Ändringar överlever omstart och deploy."
          : "Endast minne. Ändringar försvinner när servern startar om — exportera JSON och committa den."}
      </span>
      <span className="text-muted">Utgångsläge: {status.seedSource}</span>
      {status.updatedAt ? (
        <span className="text-muted">
          Senast sparat {new Date(status.updatedAt).toLocaleString("sv-SE")}
        </span>
      ) : null}
      {status.degradedReason ? (
        <span className="text-danger">Databasfel: {status.degradedReason}</span>
      ) : null}
    </div>
  );
}
