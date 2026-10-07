"use client";

import { useState, type ReactNode } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { CATEGORY_LABEL } from "@/lib/library";
import { meters, parseMeters } from "@/lib/format";
import { suggestTruckZone } from "@/lib/solver";
import { markerNumber, MAX_MARKERS } from "@/lib/flowMarkers";
import { MACHINE_DRAG_TYPE } from "@/lib/dragTypes";
import { dimensionLength } from "@/lib/dimensions";
import { useT } from "@/lib/i18n";
import { Button, Empty, Field, NumberInput, Segmented, Tag, Tip } from "./ui";
import { MachineThumb } from "./MachineThumb";
import { toolHelp } from "./toolHelp";
import type { Area } from "@/lib/areas";
import type { DrawnKind, FlowMarker, Machine, MachineCategory, Side } from "@/lib/types";
import type { Tool } from "@/store/useConfigStore";

/**
 * Innehållet i varje yta. Se lib/areas.ts för hur ytorna hänger ihop.
 *
 * Varje yta visar bara det som hör dit, i den ordning man fyller i det, med
 * en rad om varför det behövs i offerten. Verktygen som hör till ytan ligger
 * i ytan — den som öppnar "Väggar och portar" ska inte behöva leta efter
 * portverktyget någon annanstans.
 */
export function AreaBody({ area }: { area: Area }) {
  switch (area) {
    case "hall":
      return <HallArea />;
    case "walls":
      return <WallsArea />;
    case "zones":
      return <ZonesArea />;
    case "machines":
      return <MachinesArea />;
    case "line":
      return <LineArea />;
    case "points":
      return <PointsArea />;
    case "truck":
      return <TruckArea />;
    case "product":
      return <ProductArea />;
    case "quote":
      return <QuoteArea />;
  }
}

/** En rubricerad del av en yta. */
function Block({ title, children, help }: { title: string; children: ReactNode; help?: string }) {
  return (
    <section className="mb-4">
      {help ? (
        <Tip block side="left" title={title} body={help}>
          <h3 className="kicker mb-1.5 cursor-help underline decoration-dotted underline-offset-2">{title}</h3>
        </Tip>
      ) : (
        <h3 className="kicker mb-1.5">{title}</h3>
      )}
      {children}
    </section>
  );
}

/** Ytans verktyg som stora, tydliga knappar med förklaring. */
function ToolButtons({ tools }: { tools: Tool[] }) {
  const t = useT();
  const { tool, setTool } = useConfigStore();
  return (
    <div className="space-y-1">
      {tools.map((value) => {
        const help = toolHelp(t, value);
        const active = tool === value;
        return (
          <button
            key={value}
            onClick={() => setTool(active ? "select" : value)}
            className={`flex w-full items-start gap-2 border px-2 py-1.5 text-left transition-colors ${
              active ? "border-accent bg-accent text-white" : "border-divider bg-white hover:border-accent"
            }`}
          >
            <kbd className={`num mt-0.5 border px-1 text-[10px] ${active ? "border-white/60" : "border-divider text-muted"}`}>
              {help.shortcut}
            </kbd>
            <span className="min-w-0">
              <span className="block text-[13px]">{help.title}</span>
              <span className={`block text-[11px] leading-snug ${active ? "text-white/85" : "text-muted"}`}>
                {active ? help.hint : help.body}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Lista över ritade objekt av vissa slag, med markera och ta bort. */
function DrawnList({ kinds, empty }: { kinds: DrawnKind[]; empty: string }) {
  const { config, selectedId, select, removeDrawn } = useConfigStore();
  const t = useT();
  const items = config.drawn.filter((d) => kinds.includes(d.kind));
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="border border-divider">
      {items.map((d) => (
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
            aria-label={t("area.remove")}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** De sparade måtten, med markera och ta bort. */
function DimensionList() {
  const { config, selectedId, select, removeDimension } = useConfigStore();
  const t = useT();
  const items = config.dimensions ?? [];
  if (items.length === 0) return <Empty>{t("dim.empty")}</Empty>;
  return (
    <div className="border border-divider">
      {items.map((d) => (
        <div
          key={d.id}
          onClick={() => select(d.id)}
          className={`flex cursor-pointer items-center gap-2 border-b border-divider px-2 py-1 text-[12px] last:border-0 ${
            selectedId === d.id ? "bg-accent/10" : "hover:bg-paper"
          }`}
        >
          <span className="num">{meters(dimensionLength(d), 2)} m</span>
          <span className="min-w-0 flex-1 truncate text-muted">{d.note ?? ""}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeDimension(d.id);
            }}
            className="text-muted hover:text-danger"
            aria-label={t("area.remove")}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Lokalen ───────────────────────────────────────────────────────────── */

function HallArea() {
  const t = useT();
  const { config, update } = useConfigStore();
  return (
    <>
      <Block title={t("area.hall.size")}>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["sidebar.length", "lengthMm", 5000],
              ["sidebar.width", "widthMm", 5000],
              ["sidebar.height", "clearHeightMm", 2000],
            ] as const
          ).map(([label, key, min]) => (
            <Field key={key} label={`${t(label)} m`}>
              <NumberInput
                value={meters(config.hall[key])}
                onCommit={(raw) => {
                  const mm = parseMeters(raw);
                  if (mm !== null && mm >= min) update((d) => void (d.hall[key] = mm));
                }}
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{t("guide.hall.drag")}</p>
      </Block>
      <Block title={t("area.hall.heightTitle")}>
        <p className="text-[11px] leading-relaxed text-muted">{t("area.hall.heightHelp")}</p>
      </Block>
    </>
  );
}

function WallsArea() {
  const t = useT();
  return (
    <>
      <Block title={t("area.tools")}>
        <ToolButtons tools={["door", "wall", "measure"]} />
      </Block>
      <Block title={t("area.walls.list")}>
        <DrawnList kinds={["door", "wall"]} empty={t("area.walls.empty")} />
      </Block>
      <Block title={t("dim.list")} help={t("dim.listHelp")}>
        <DimensionList />
      </Block>
    </>
  );
}

function ZonesArea() {
  const t = useT();
  return (
    <>
      <Block title={t("area.tools")}>
        <ToolButtons tools={["nogo", "measure"]} />
      </Block>
      <Block title={t("area.zones.list")}>
        <DrawnList kinds={["nogo"]} empty={t("area.zones.empty")} />
      </Block>
    </>
  );
}

/* ── Anläggningen ──────────────────────────────────────────────────────── */

function MachinesArea() {
  const t = useT();
  const { library, addMachine, setDraggingMachine } = useConfigStore();
  const [search, setSearch] = useState("");

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
    <>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("sidebar.search")}
        className="mb-2 w-full border border-divider px-2 py-1 text-sm outline-none focus:border-accent"
      />
      <p className="mb-3 text-[11px] text-muted">{t("sidebar.addHint")}</p>
      <div className="space-y-3">
        {Object.entries(grouped).map(([category, machines]) => (
          <div key={category}>
            <div className="kicker mb-1">{CATEGORY_LABEL[category as MachineCategory]}</div>
            <div className="space-y-1">
              {machines.map((machine) => (
                <button
                  key={machine.id}
                  draggable
                  /*
                   * Dra maskinen dit den ska, i planen eller i modellvyn, eller
                   * klicka för att lägga den på ledig yta.
                   */
                  onDragStart={(e) => {
                    setDraggingMachine(machine.id);
                    e.dataTransfer.setData(MACHINE_DRAG_TYPE, machine.id);
                    e.dataTransfer.setData("text/plain", machine.name);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onDragEnd={() => setDraggingMachine(null)}
                  onClick={() => addMachine(machine.id)}
                  className="blueprint flex w-full cursor-grab items-start gap-2 bg-white p-2 text-left hover:border-accent active:cursor-grabbing"
                >
                  <MachineThumb machine={machine} className="mt-0.5 h-8 w-11" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px]">{machine.name}</div>
                    <div className="kicker truncate">
                      {machine.capacity.packagesPerHour > 0 ? `${machine.capacity.packagesPerHour} pkt/h · ` : ""}
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
        {Object.keys(grouped).length === 0 ? <Empty>{t("sidebar.noMatch")}</Empty> : null}
      </div>
    </>
  );
}

function LineArea() {
  const t = useT();
  const { config, layout, selectedId, select, moveItem, removeItem, toggleDiagnostics } = useConfigStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const errors = layout.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = layout.diagnostics.filter((d) => d.severity === "warning").length;

  return (
    <>
      <Block title={t("area.line.list", { count: config.line.length })}>
        {config.line.length === 0 ? (
          <Empty>{t("area.line.empty")}</Empty>
        ) : (
          <div className="border border-divider">
            {config.line.map((item, index) => {
              const placement = layout.placements.find((p) => p.instanceId === item.instanceId);
              const issues = layout.diagnostics.filter((d) => d.instanceIds.includes(item.instanceId));
              const worst = issues.some((d) => d.severity === "error")
                ? "error"
                : issues.some((d) => d.severity === "warning")
                  ? "warning"
                  : null;
              return (
                <div
                  key={item.instanceId}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== index) moveItem(config.line[dragIndex].instanceId, index);
                    setDragIndex(null);
                  }}
                  onClick={() => select(item.instanceId)}
                  className={`flex cursor-pointer items-center gap-2 border-b border-divider px-2 py-1.5 text-[13px] last:border-0 ${
                    selectedId === item.instanceId ? "bg-accent/10" : "hover:bg-paper"
                  }`}
                >
                  <span className="text-muted">⠿</span>
                  <span className="num w-4 text-muted">{placement?.aux ? "·" : placement?.pos}</span>
                  <span className="min-w-0 flex-1 truncate">{placement?.machine.name ?? item.machineId}</span>
                  {worst ? (
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${worst === "error" ? "bg-danger" : "bg-warn"}`}
                      title={issues.map((d) => d.title).join(", ")}
                    />
                  ) : null}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(item.instanceId);
                    }}
                    className="text-muted hover:text-danger"
                    aria-label={t("area.remove")}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Block>
      <Block title={t("area.line.check")}>
        <p className="mb-2 text-[12px] leading-relaxed">
          {errors + warnings === 0 ? t("area.line.clean") : t("area.line.issues", { errors, warnings })}
        </p>
        {errors + warnings > 0 ? (
          <Button size="sm" onClick={() => toggleDiagnostics(true)}>
            {t("area.line.showIssues")}
          </Button>
        ) : null}
      </Block>
    </>
  );
}

/* ── Flödet ────────────────────────────────────────────────────────────── */

function PointsArea() {
  const t = useT();
  const {
    config,
    setStartPoint,
    setStartComment,
    addFlowMarker,
    updateFlowMarker,
    removeFlowMarker,
    activateFlowMarker,
  } = useConfigStore();
  const full = (config.flow.markers?.length ?? 0) >= MAX_MARKERS;

  return (
    <>
      <Block title={t("sidebar.newMachinesAt")} help={t("points.why")}>
        <p className="mb-2 text-[11px] text-muted">{t("sidebar.startPointHint")}</p>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Field label={t("sidebar.startX")}>
            <NumberInput
              value={meters(config.flow.startPoint.x)}
              onCommit={(raw) => {
                const mm = parseMeters(raw);
                if (mm !== null) setStartPoint({ ...config.flow.startPoint, x: mm });
              }}
            />
          </Field>
          <Field label={t("sidebar.startY")}>
            <NumberInput
              value={meters(config.flow.startPoint.y)}
              onCommit={(raw) => {
                const mm = parseMeters(raw);
                if (mm !== null) setStartPoint({ ...config.flow.startPoint, y: mm });
              }}
            />
          </Field>
        </div>
        <CommentInput
          label={t("points.why.label")}
          placeholder={t("points.startPlaceholder")}
          value={config.flow.startComment ?? ""}
          help={t("points.startHelp")}
          onCommit={setStartComment}
        />
      </Block>

      <Block title={t("points.more")} help={t("points.moreTip")}>
        {(config.flow.markers ?? []).map((marker) => (
          <MarkerRow
            key={marker.id}
            label={`${t(marker.role === "start" ? "points.start" : "points.end")} ${markerNumber(config.flow, marker)}`}
            marker={marker}
            onComment={(comment) => updateFlowMarker(marker.id, { comment })}
            onActivate={() => activateFlowMarker(marker.id)}
            onRemove={() => removeFlowMarker(marker.id)}
          />
        ))}
        <div className="grid grid-cols-2 gap-1">
          <Tip block title={t("points.addStartTip")} body={t("points.startHelp")}>
            <Button size="sm" className="w-full" disabled={full} onClick={() => addFlowMarker("start")}>
              {t("points.addStart")}
            </Button>
          </Tip>
          <Tip block title={t("points.addEndTip")} body={t("points.endHelp")}>
            <Button size="sm" className="w-full" disabled={full} onClick={() => addFlowMarker("end")}>
              {t("points.addEnd")}
            </Button>
          </Tip>
        </div>
      </Block>
    </>
  );
}

function TruckArea() {
  const t = useT();
  const { config, layout, setFlow, addDrawn } = useConfigStore();
  const options: { value: Side; label: string }[] = [
    { value: "right", label: t("side.right") },
    { value: "left", label: t("side.left") },
  ];
  return (
    <>
      <Block title={t("sidebar.truckPickup")}>
        <Segmented
          ariaLabel={t("sidebar.truckPickup")}
          value={config.flow.truckPickupSide}
          options={options}
          onChange={(v) => setFlow({ truckPickupSide: v })}
        />
      </Block>
      <Block title={t("area.tools")}>
        <ToolButtons tools={["truck"]} />
        <Tip block title={t("guide.zones.pickup")} body={t("guide.zones.pickupTip")}>
          <Button
            size="sm"
            className="mt-1 w-full"
            onClick={() => {
              const zone = suggestTruckZone(layout.bounds, "x+", config.flow.truckPickupSide);
              addDrawn({ id: `truck-${Date.now().toString(36)}`, kind: "truck", name: "Hämtzon", ...zone, h: 0 });
            }}
          >
            {t("guide.zones.pickup")}
          </Button>
        </Tip>
      </Block>
      <Block title={t("area.truck.list")}>
        <DrawnList kinds={["truck"]} empty={t("area.truck.empty")} />
      </Block>
    </>
  );
}

function ProductArea() {
  const t = useT();
  const { config, update } = useConfigStore();
  const mm = (key: "packageLengthMm" | "packageWidthMinMm" | "packageWidthMaxMm" | "packageHeightMm") => (
    <NumberInput
      value={meters(config.product[key])}
      suffix="m"
      onCommit={(raw) => {
        const value = parseMeters(raw);
        if (value !== null && value > 0) update((d) => void (d.product[key] = value));
      }}
    />
  );
  const whole = (key: "packageWeightKg" | "targetPackagesPerHour", suffix: string) => (
    <NumberInput
      value={String(config.product[key])}
      suffix={suffix}
      step="1"
      onCommit={(raw) => {
        const value = Math.round(Number(raw.replace(",", ".")));
        if (Number.isFinite(value) && value > 0) update((d) => void (d.product[key] = value));
      }}
    />
  );
  return (
    <>
      <Block title={t("area.product.width")} help={t("area.product.widthHelp")}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("sidebar.widthMin")}>{mm("packageWidthMinMm")}</Field>
          <Field label={t("sidebar.widthMax")}>{mm("packageWidthMaxMm")}</Field>
        </div>
      </Block>
      <Block title={t("area.product.package")}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("sidebar.packageLength")}>{mm("packageLengthMm")}</Field>
          <Field label={t("area.product.height")}>{mm("packageHeightMm")}</Field>
          <Field label={t("area.product.weight")}>{whole("packageWeightKg", "kg")}</Field>
        </div>
      </Block>
      <Block title={t("sidebar.target")} help={t("area.product.targetHelp")}>
        {whole("targetPackagesPerHour", "pkt/h")}
      </Block>
    </>
  );
}

/* ── Offert ────────────────────────────────────────────────────────────── */

function QuoteArea() {
  const t = useT();
  const { config, layout, setScreen, toggleDiagnostics } = useConfigStore();
  const errors = layout.diagnostics.filter((d) => d.severity === "error").length;
  return (
    <>
      <Block title={t("area.quote.summary")}>
        <ul className="space-y-1 text-[12px]">
          <li>{t("area.quote.machines", { count: config.line.length })}</li>
          <li>
            {t("area.quote.hall", { l: meters(config.hall.lengthMm), w: meters(config.hall.widthMm) })}
          </li>
          <li className={errors ? "text-danger" : undefined}>
            {errors ? t("area.quote.errors", { count: errors }) : t("area.quote.noErrors")}
          </li>
        </ul>
        {errors ? (
          <Button size="sm" className="mt-2" onClick={() => toggleDiagnostics(true)}>
            {t("area.line.showIssues")}
          </Button>
        ) : null}
      </Block>
      <div className="space-y-2">
        <Button variant="primary" className="w-full" onClick={() => setScreen("quote")}>
          {t("guide.quote.go")}
        </Button>
        <ShareButton />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">{t("area.quote.disclaimer")}</p>
    </>
  );
}

function ShareButton() {
  const t = useT();
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
      window.prompt(t("sidebar.shareCopy"), url);
      setState("idle");
    }
  };

  return (
    <div>
      <Button className="w-full" onClick={share}>
        {state === "idle" || state === "failed" ? t("sidebar.share") : t("sidebar.shareCopied")}
      </Button>
      {state === "long" ? (
        <p className="mt-1 text-[11px] leading-relaxed text-warn">{t("sidebar.shareLong")}</p>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Hela konfigurationen ligger i länken. Inget sparas på servern, och mottagaren
          behöver inget konto.
        </p>
      )}
    </div>
  );
}

/** Kommentarfält som sparar när man lämnar det, så att varje tecken inte blir ett ångra-steg. */
function CommentInput({
  label,
  placeholder,
  value,
  help,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: string;
  help: string;
  onCommit: (text: string) => void;
}) {
  return (
    <label className="mb-2 block">
      <Tip block side="right" title={label} body={help}>
        <span className="kicker mb-1 block">{label}</span>
      </Tip>
      <input
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        maxLength={300}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() !== value) onCommit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full border border-divider bg-white px-2 py-1 text-[12px] outline-none placeholder:text-muted/70 focus:border-accent"
      />
    </label>
  );
}

function MarkerRow({
  label,
  marker,
  onComment,
  onActivate,
  onRemove,
}: {
  label: string;
  marker: FlowMarker;
  onComment: (comment: string) => void;
  onActivate: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className="mb-1.5 border border-dashed border-divider p-1.5">
      <div className="mb-1 flex items-center gap-2">
        <span className={`kicker ${marker.role === "start" ? "text-accent" : "text-steel"}`}>{label}</span>
        <span className="num text-[11px] text-muted">
          {meters(marker.pos.x)} × {meters(marker.pos.y)} m
        </span>
        <span className="ml-auto flex items-center gap-1">
          {marker.role === "start" ? (
            <Tip side="right" title={t("points.activate")} body={t("points.activateTip")}>
              <button onClick={onActivate} className="kicker border border-divider px-1 hover:border-accent hover:text-accent">
                {t("points.activate")}
              </button>
            </Tip>
          ) : null}
          <button onClick={onRemove} className="text-muted hover:text-danger" aria-label="Ta bort">
            ×
          </button>
        </span>
      </div>
      <input
        key={marker.comment}
        defaultValue={marker.comment}
        placeholder={t("points.placeholder")}
        maxLength={300}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() !== marker.comment) onComment(e.currentTarget.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full border border-divider bg-white px-2 py-0.5 text-[12px] outline-none placeholder:text-muted/70 focus:border-accent"
      />
    </div>
  );
}
