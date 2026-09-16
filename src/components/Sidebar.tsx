"use client";

import { useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { CATEGORY_LABEL } from "@/lib/library";
import { meters, parseMeters } from "@/lib/format";
import { suggestTruckZone } from "@/lib/solver";
import { Button, Empty, Field, NumberInput, SectionHeading, Segmented, Tag } from "./ui";
import { MachineThumb } from "./MachineThumb";
import type { Machine, MachineCategory, Side } from "@/lib/types";

const SIDE_OPTIONS: { value: Side; label: string }[] = [
  { value: "right", label: "Höger" },
  { value: "left", label: "Vänster" },
];

export function Sidebar() {
  const {
    config,
    selectedId,
    tool,
    addMachine,
    removeItem,
    moveItem,
    select,
    setFlow,
    update,
    setTool,
    clearDrawn,
    removeDrawn,
    addDrawn,
    setScreen,
    library,
    layout,
    setFlowPoint,
  } = useConfigStore();

  const [search, setSearch] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const hasStickerStacker = config.line.some((i) => i.machineId === "ts4");

  const grouped = library.machines
    .filter((m) => {
      const q = search.trim().toLowerCase();
      return !q || m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q);
    })
    .reduce<Record<string, Machine[]>>((acc, machine) => {
      (acc[machine.category] ??= []).push(machine);
      return acc;
    }, {});

  return (
    <aside className="scroll-thin flex h-full w-[280px] flex-none flex-col overflow-y-auto border-r border-divider bg-white">
      {/* ① Maskiner */}
      <section className="border-b border-divider p-3">
        <SectionHeading index={1} title="Maskiner" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök maskin…"
          className="mb-2 w-full border border-divider px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <p className="mb-2 text-[11px] text-muted">Klicka för att lägga sist i linjen.</p>

        <div className="space-y-3">
          {Object.entries(grouped).map(([category, machines]) => (
            <div key={category}>
              <div className="kicker mb-1">{CATEGORY_LABEL[category as MachineCategory]}</div>
              <div className="space-y-1">
                {machines.map((machine) => (
                  <button
                    key={machine.id}
                    onClick={() => addMachine(machine.id)}
                    className="blueprint flex w-full items-start gap-2 bg-white p-2 text-left hover:border-accent"
                  >
                    <MachineThumb machine={machine} className="mt-0.5 h-8 w-11" />
                    <div className="min-w-0">
                      <div className="truncate text-[13px]">{machine.name}</div>
                      <div className="kicker truncate">
                        {machine.capacity.packagesPerHour > 0
                          ? `${machine.capacity.packagesPerHour} pkt/h · `
                          : ""}
                        {meters(machine.footprint.lengthMm)} m
                      </div>
                      {machine.stepFile ? (
                        <div className="mt-1">
                          <Tag tone="accent">STEP</Tag>
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(grouped).length === 0 ? <Empty>Ingen maskin matchar sökningen.</Empty> : null}
        </div>
      </section>

      {/* ② Linjen */}
      <section className="border-b border-divider p-3">
        <SectionHeading
          index={2}
          title="Linjen"
          action={<span className="kicker">{config.line.length} st</span>}
        />
        {config.line.length === 0 ? (
          <Empty>Linjen är tom. Lägg till en maskin ovanför.</Empty>
        ) : (
          <div className="border border-divider">
            {config.line.map((item, index) => {
              const placement = layout.placements.find((p) => p.instanceId === item.instanceId);
              const machine = placement?.machine;
              return (
                <div
                  key={item.instanceId}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== index) {
                      moveItem(config.line[dragIndex].instanceId, index);
                    }
                    setDragIndex(null);
                  }}
                  onClick={() => select(item.instanceId)}
                  className={`flex cursor-pointer items-center gap-2 border-b border-divider px-2 py-1.5 text-[13px] last:border-0 ${
                    selectedId === item.instanceId ? "bg-accent/10" : "hover:bg-paper"
                  }`}
                >
                  <span className="text-muted">⠿</span>
                  <span className="num w-4 text-muted">{placement?.aux ? "·" : placement?.pos}</span>
                  <span className="min-w-0 flex-1 truncate">{machine?.name ?? item.machineId}</span>
                  <span className="num text-[11px] text-muted">
                    {placement ? `${meters(placement.size.lengthMm)} m` : "—"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(item.instanceId);
                    }}
                    className="text-muted hover:text-danger"
                    aria-label="Ta bort"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ③ Flöde — de fem frågorna */}
      <section className="border-b border-divider p-3">
        <SectionHeading index={3} title="Flöde" />

        <div className="mb-3">
          <span className="kicker mb-1 block">Paketen kommer in</span>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                { value: "straight", label: "Rakt", path: "M4 11h22M22 6l5 5-5 5" },
                { value: "right", label: "Höger", path: "M8 3v8h18M22 6l5 5-5 5" },
                { value: "left", label: "Vänster", path: "M8 19v-8h18M22 6l5 5-5 5" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                onClick={() => setFlow({ infeedFrom: option.value })}
                className={`blueprint flex flex-col items-center gap-1 py-2 text-[11px] ${
                  config.flow.infeedFrom === option.value
                    ? "border-accent bg-accent text-white"
                    : "bg-white hover:border-accent"
                }`}
              >
                <svg width="30" height="20" viewBox="0 0 30 22" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d={option.path} />
                </svg>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <span className="kicker mb-1 block">Pulpetens sida</span>
            <Segmented
              ariaLabel="Pulpetens sida"
              value={config.flow.controlDeskSide}
              options={SIDE_OPTIONS}
              onChange={(v) => setFlow({ controlDeskSide: v })}
            />
          </div>

          {/* Frågan ställs bara när en truckströläggare finns i linjen. */}
          {hasStickerStacker ? (
            <div>
              <span className="kicker mb-1 block">Ströfacksmagasinets sida</span>
              <Segmented
                ariaLabel="Ströfacksmagasinets sida"
                value={config.flow.stickerMagazineSide}
                options={SIDE_OPTIONS}
                onChange={(v) => setFlow({ stickerMagazineSide: v })}
              />
            </div>
          ) : null}

          <div>
            <span className="kicker mb-1 block">Trucken hämtar från</span>
            <Segmented
              ariaLabel="Trucken hämtar från"
              value={config.flow.truckPickupSide}
              options={SIDE_OPTIONS}
              onChange={(v) => setFlow({ truckPickupSide: v })}
            />
          </div>

          <Field label="Sista kedjetransportörens längd">
            <NumberInput
              value={meters(config.flow.finalConveyorLengthMm)}
              suffix="m"
              min={1}
              max={40}
              onCommit={(raw) => {
                const mm = parseMeters(raw);
                if (mm !== null) setFlow({ finalConveyorLengthMm: Math.min(40000, Math.max(1000, mm)) });
              }}
            />
          </Field>
        </div>

        {/* Start- och slutpunkt: kan också dras direkt i ritningen. */}
        <div className="mt-4 border-t border-divider pt-3">
          <span className="kicker mb-1 block">Linjens start och slut</span>
          <p className="mb-2 text-[11px] text-muted">Dra markörerna i ritningen, eller skriv måtten här.</p>

          <div className="mb-2 grid grid-cols-2 gap-2">
            <Field label="Start X">
              <NumberInput
                value={meters(config.flow.startPoint.x)}
                onCommit={(raw) => {
                  const mm = parseMeters(raw);
                  if (mm !== null) setFlowPoint("startPoint", { ...config.flow.startPoint, x: mm });
                }}
              />
            </Field>
            <Field label="Start Y">
              <NumberInput
                value={meters(config.flow.startPoint.y)}
                onCommit={(raw) => {
                  const mm = parseMeters(raw);
                  if (mm !== null) setFlowPoint("startPoint", { ...config.flow.startPoint, y: mm });
                }}
              />
            </Field>
          </div>

          {config.flow.endPoint ? (
            <>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <Field label="Slut X">
                  <NumberInput
                    value={meters(config.flow.endPoint.x)}
                    onCommit={(raw) => {
                      const mm = parseMeters(raw);
                      if (mm !== null && config.flow.endPoint)
                        setFlowPoint("endPoint", { ...config.flow.endPoint, x: mm });
                    }}
                  />
                </Field>
                <Field label="Slut Y">
                  <NumberInput
                    value={meters(config.flow.endPoint.y)}
                    onCommit={(raw) => {
                      const mm = parseMeters(raw);
                      if (mm !== null && config.flow.endPoint)
                        setFlowPoint("endPoint", { ...config.flow.endPoint, y: mm });
                    }}
                  />
                </Field>
              </div>
              <label className="mb-2 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={config.flow.fitToEndPoint}
                  onChange={(e) => setFlow({ fitToEndPoint: e.target.checked })}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  <span className="text-[13px]">Anpassa längden automatiskt</span>
                  <span className="block text-[11px] leading-relaxed text-muted">
                    Sätter sista kedjetransportörens längd så att linjen slutar i punkten.
                  </span>
                </span>
              </label>
              <Button size="sm" variant="ghost" onClick={() => setFlowPoint("endPoint", null)}>
                Ta bort slutpunkt
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="w-full"
              onClick={() =>
                setFlowPoint("endPoint", {
                  x: Math.max(0, layout.bounds.x + layout.bounds.l),
                  y: config.flow.startPoint.y,
                })
              }
            >
              Sätt slutpunkt
            </Button>
          )}
          {layout.metrics.endPointGapMm !== null ? (
            <p className="mt-2 text-[11px] text-muted">
              Linjen slutar {meters(layout.metrics.endPointGapMm)} m från slutpunkten.
            </p>
          ) : null}
        </div>

        {/* Virkesbredd som intervall — maskinernas portar måste täcka hela spannet. */}
        <div className="mt-4 border-t border-divider pt-3">
          <span className="kicker mb-1 block">Virke</span>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Field label="Minsta virkesbredd">
              <NumberInput
                value={meters(config.product.packageWidthMinMm)}
                onCommit={(raw) => {
                  const mm = parseMeters(raw);
                  if (mm !== null) update((d) => void (d.product.packageWidthMinMm = mm));
                }}
              />
            </Field>
            <Field label="Största virkesbredd">
              <NumberInput
                value={meters(config.product.packageWidthMaxMm)}
                onCommit={(raw) => {
                  const mm = parseMeters(raw);
                  if (mm !== null) update((d) => void (d.product.packageWidthMaxMm = mm));
                }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Paketlängd">
              <NumberInput
                value={meters(config.product.packageLengthMm)}
                onCommit={(raw) => {
                  const mm = parseMeters(raw);
                  if (mm !== null) update((d) => void (d.product.packageLengthMm = mm));
                }}
              />
            </Field>
            <Field label="Målkapacitet">
              <NumberInput
                value={String(config.product.targetPackagesPerHour)}
                suffix="pkt/h"
                step="1"
                onCommit={(raw) => {
                  const value = Math.round(Number(raw.replace(",", ".")));
                  if (Number.isFinite(value) && value > 0)
                    update((d) => void (d.product.targetPackagesPerHour = value));
                }}
              />
            </Field>
          </div>
        </div>
      </section>

      {/* ④ Hall och zoner */}
      <section className="border-b border-divider p-3">
        <SectionHeading index={4} title="Hall och zoner" />
        <div className="mb-3 grid grid-cols-3 gap-2">
          {(
            [
              ["Längd", "lengthMm"],
              ["Bredd", "widthMm"],
              ["Höjd", "clearHeightMm"],
            ] as const
          ).map(([label, key]) => (
            <Field key={key} label={`${label} m`}>
              <NumberInput
                value={meters(config.hall[key])}
                onCommit={(raw) => {
                  const mm = parseMeters(raw);
                  if (mm !== null && mm >= 2000) update((d) => void (d.hall[key] = mm));
                }}
              />
            </Field>
          ))}
        </div>

        <span className="kicker mb-1 block">Ritverktyg</span>
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              ["select", "Markera"],
              ["wall", "Vägg"],
              ["door", "Port"],
              ["truck", "Truckgata"],
              ["nogo", "No-go"],
              ["measure", "Mät"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTool(value)}
              className={`border px-2 py-1 text-xs transition-colors ${
                tool === value
                  ? "border-accent bg-accent text-white"
                  : "border-divider bg-white hover:border-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {tool === "select"
            ? "Dra maskiner och zoner i vyn. Snapp 250 mm."
            : tool === "wall"
              ? "Dra åt det håll väggen ska gå. Den låses till närmaste axel och blir 300 mm tjock."
              : tool === "door"
                ? "Dra där porten sitter, i x- eller y-led. Låses till närmaste axel."
                : tool === "truck"
                  ? "Dra en rektangel där trucken kör eller hämtar. Kan vara en hel gata eller bara en hämtzon."
                  : tool === "nogo"
                    ? "Dra en rektangel för att spärra en yta."
                    : "Dra mellan två punkter för att mäta avståndet."}
        </p>

        <div className="mt-2 flex flex-wrap gap-1">
          <Button
            size="sm"
            onClick={() => {
              const zone = suggestTruckZone(
                layout.bounds,
                "x+",
                config.flow.truckPickupSide,
              );
              addDrawn({
                id: `truck-${Date.now().toString(36)}`,
                kind: "truck",
                name: "Hämtzon",
                ...zone,
                h: 0,
              });
            }}
          >
            + Hämtzon vid utlastningen
          </Button>
        </div>

        {config.drawn.length > 0 ? (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="kicker">{config.drawn.length} ritade objekt</span>
              <Button variant="ghost" size="sm" onClick={clearDrawn}>
                Rensa
              </Button>
            </div>
            <div className="border border-divider">
              {config.drawn.map((d) => (
                <div
                  key={d.id}
                  onClick={() => select(d.id)}
                  className={`flex cursor-pointer items-center gap-2 border-b border-divider px-2 py-1 text-[12px] last:border-0 ${
                    selectedId === d.id ? "bg-accent/10" : "hover:bg-paper"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className="num text-[11px] text-muted">
                    {meters(d.l)}×{meters(d.w)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDrawn(d.id);
                    }}
                    className="text-muted hover:text-danger"
                    aria-label="Ta bort"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* ⑤ Offert */}
      <section className="p-3">
        <SectionHeading index={5} title="Offert" />
        <div className="space-y-2">
          <Button variant="primary" className="w-full" onClick={() => setScreen("quote")}>
            Sammanställ offertunderlag
          </Button>
          <ShareButton />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Prisindikation, ej bindande offert. Verklig anläggning kräver platsbesök och
          konstruktionsgranskning.
        </p>
      </section>
    </aside>
  );
}

function ShareButton() {
  const config = useConfigStore((s) => s.config);
  const note = useConfigStore((s) => s.note);
  const [state, setState] = useState<"idle" | "copied" | "long" | "failed">("idle");

  const share = async () => {
    const { shareUrl } = await import("@/lib/share");
    const { url, long } = await shareUrl(config, window.location.origin, window.location.pathname);
    note("share", "Skapade en delningslänk");
    try {
      await navigator.clipboard.writeText(url);
      setState(long ? "long" : "copied");
      setTimeout(() => setState("idle"), long ? 8000 : 2000);
    } catch {
      // Utklippet kräver säker kontext och kan nekas. Då får man länken ändå.
      window.prompt("Kopiera länken:", url);
      setState("idle");
    }
  };

  return (
    <div>
      <Button className="w-full" onClick={share}>
        {state === "idle" || state === "failed" ? "Kopiera delningslänk" : "Länk kopierad"}
      </Button>
      {state === "long" ? (
        <p className="mt-1 text-[11px] leading-relaxed text-warn">
          Länken blev lång. Skicka den som klickbar länk — vissa e-postklienter bryter
          långa adresser och då går den inte att öppna.
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Hela konfigurationen ligger i länken. Inget sparas på servern, och mottagaren
          behöver inget konto.
        </p>
      )}
    </div>
  );
}
