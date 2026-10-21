"use client";

import { useState, type ReactNode } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { CATEGORY_LABEL } from "@/lib/library";
import { meters, parseMeters } from "@/lib/format";
import { suggestTruckZone } from "@/lib/solver";
import { nextName } from "@/lib/drawing";
import { ZONES, zoneDef } from "@/lib/zones";
import { markerNumber, MAX_MARKERS } from "@/lib/flowMarkers";
import { MACHINE_DRAG_TYPE } from "@/lib/dragTypes";
import { dimensionLength } from "@/lib/dimensions";
import { clampTo, HALL_LIMITS, setProductValue } from "@/lib/limits";
import { useT } from "@/lib/i18n";
import {
  Button,
  cx,
  Empty,
  Field,
  NumberInput,
  Segmented,
  Tag,
  Tip,
} from "./ui";
import { MachineThumb } from "./MachineThumb";
import { toolHelp } from "./toolHelp";
import type { Area } from "@/lib/areas";
import type { SectionId } from "@/store/useConfigStore";
import type {
  DrawnKind,
  FlowMarker,
  Machine,
  MachineCategory,
  Side,
} from "@/lib/types";
import type { Tool } from "@/store/useConfigStore";

/**
 * Innehållet i varje steg. Se lib/areas.ts för hur stegen hänger ihop.
 *
 * Ett steg ställer en fråga, och delarna inuti det är de gamla ytorna:
 * samma block, samma verktyg, samma listor, men utan en egen skärm var.
 * Delarna fälls ihop, så att panelen aldrig blir en lång rulle — den
 * första står öppen och resten är ett klick bort.
 */
export function AreaBody({ area }: { area: Area }) {
  switch (area) {
    case "site":
      return <SiteArea />;
    case "plant":
      return <PlantArea />;
    case "product":
      return <ProductArea />;
    case "quote":
      return <QuoteArea />;
  }
}

/**
 * En hopfällbar del av ett steg.
 *
 * Öppet/stängt-läget ligger i butiken och inte här, så att det överlever
 * att man går till ett annat steg och tillbaka: den som fällt ut zonerna
 * har sagt att det är dem hen arbetar med.
 */
function Section({
  id,
  title,
  meta,
  children,
}: {
  id: SectionId;
  title: string;
  meta: string;
  children: ReactNode;
}) {
  const { openSections, toggleSection } = useConfigStore();
  const open = openSections.includes(id);
  return (
    <div className="mb-2 border border-divider" data-open={open}>
      <button
        onClick={() => toggleSection(id)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-paper"
      >
        <span
          className={cx(
            "text-[10px] text-muted transition-transform",
            !open && "-rotate-90",
          )}
        >
          ▾
        </span>
        <span className="flex-1 text-[13px] font-medium">{title}</span>
        <span className="num text-[11px] text-muted">{meta}</span>
      </button>
      {open ? (
        <div className="border-t border-divider p-2">{children}</div>
      ) : null}
    </div>
  );
}

/* ── Stegen ────────────────────────────────────────────────────────────── */

/** Steg 1: hallens mått, väggarna och ytorna i den. */
function SiteArea() {
  const t = useT();
  const { config } = useConfigStore();
  const doors = config.drawn.filter((d) => d.kind === "door").length;
  const walls = config.drawn.filter((d) => d.kind === "wall").length;
  const zones = config.drawn.filter((d) => d.kind === "zone").length;
  return (
    <>
      <Section
        id="hall"
        title={t("area.hall.title")}
        meta={`${meters(config.hall.lengthMm)} × ${meters(config.hall.widthMm)} m`}
      >
        <HallArea />
      </Section>
      <Section
        id="walls"
        title={t("area.walls.title")}
        meta={t("nav.status.walls", { doors, walls })}
      >
        <WallsArea />
      </Section>
      <Section
        id="zones"
        title={t("area.zones.title")}
        meta={t("nav.status.zones", { count: zones })}
      >
        <ZonesArea />
      </Section>
    </>
  );
}

/** Steg 2: maskinerna, deras ordning och var paketen kommer in. */
function PlantArea() {
  const t = useT();
  const { config, library } = useConfigStore();
  return (
    <>
      <Section
        id="machines"
        title={t("area.machines.title")}
        meta={t("nav.status.machines", { count: library.machines.length })}
      >
        <MachinesArea />
      </Section>
      <Section
        id="line"
        title={t("area.line.title")}
        meta={t("nav.status.machines", { count: config.line.length })}
      >
        <LineArea />
      </Section>
      <Section
        id="points"
        title={t("area.points.title")}
        meta={t("nav.status.points", {
          count: 1 + (config.flow.markers?.length ?? 0),
        })}
      >
        <PointsArea />
      </Section>
    </>
  );
}

/** En rubricerad del av en yta. */
function Block({
  title,
  children,
  help,
}: {
  title: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <section className="mb-4">
      {help ? (
        <Tip block side="left" title={title} body={help}>
          <h3 className="kicker mb-1.5 cursor-help underline decoration-dotted underline-offset-2">
            {title}
          </h3>
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
              active
                ? "border-accent bg-accent text-white"
                : "border-divider bg-white hover:border-accent"
            }`}
          >
            <kbd
              className={`num mt-0.5 border px-1 text-[10px] ${active ? "border-white/60" : "border-divider text-muted"}`}
            >
              {help.shortcut}
            </kbd>
            <span className="min-w-0">
              <span className="block text-[13px]">{help.title}</span>
              <span
                className={`block text-[11px] leading-snug ${active ? "text-white/85" : "text-muted"}`}
              >
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
          {/* Samma färgprick som i planen: med sex zoner i hallen hittar
              man rätt rad utan att klicka sig igenom dem. */}
          <span
            aria-hidden
            className="h-2 w-2 flex-none border"
            style={{
              borderColor:
                d.kind === "zone" ? zoneDef(d.zone).stroke : "#1d1f20",
              background:
                d.kind === "zone" ? `${zoneDef(d.zone).tint}33` : "transparent",
            }}
          />
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
          <span className="min-w-0 flex-1 truncate text-muted">
            {d.note ?? ""}
          </span>
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
                  if (mm !== null && mm >= min)
                    update(
                      (d) => void (d.hall[key] = clampTo(mm, HALL_LIMITS[key])),
                    );
                }}
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {t("guide.hall.drag")}
        </p>
      </Block>
      <Block title={t("area.hall.heightTitle")}>
        <p className="text-[11px] leading-relaxed text-muted">
          {t("area.hall.heightHelp")}
        </p>
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

/**
 * Zonerna: en yta för alla slags ytor kunden vill markera.
 *
 * Förut fanns två ytor med var sitt verktyg — no-go här och truckzon under
 * flödet — och allt annat kunden ville rita in i sin hall, lagerytan,
 * operatörsplatsen, elcentralen, fick bli en no-go-zon med ett påhittat
 * namn, och därmed ett fel i regelverket. Nu väljer man sorts zon och ritar.
 * Sorterna står i lib/zones; en ny sort är en rad där, inte en yta här.
 *
 * Truckens hämtsida hör hit av samma skäl: den styr var förslaget på
 * truckzon hamnar, och den frågan ställs där truckzonen ritas.
 */
function ZonesArea() {
  const t = useT();
  const { config, layout, zoneKind, setZoneKind, tool, setFlow, addDrawn } =
    useConfigStore();
  const active = zoneDef(zoneKind);
  const sides: { value: Side; label: string }[] = [
    { value: "right", label: t("side.right") },
    { value: "left", label: t("side.left") },
  ];

  /*
   * Lägger zonen på en rimlig plats i stället för att låta kunden rita den.
   * Truckzonen hamnar där trucken hämtar; allt annat läggs som en kvadrat
   * bredvid anläggningen, synlig direkt och lätt att dra dit den ska.
   */
  const place = () => {
    const box = suggestTruckZone(
      layout.bounds,
      "x+",
      config.flow.truckPickupSide,
    );
    const square = Math.min(4000, Math.max(2000, Math.min(box.l, box.w)));
    addDrawn({
      id: `${zoneKind}-${Date.now().toString(36)}`,
      kind: "zone",
      zone: zoneKind,
      name: nextName("zone", config.drawn, t, zoneKind),
      ...(active.aisle
        ? box
        : { x: Math.round(box.x), y: Math.round(box.y), l: square, w: square }),
      h: 0,
    });
  };

  return (
    <>
      <Block title={t("area.zones.kind")} help={t("area.zones.kindHelp")}>
        <div className="grid grid-cols-2 gap-1">
          {ZONES.map((zone) => {
            const on = tool === "zone" && zoneKind === zone.id;
            return (
              <button
                key={zone.id}
                onClick={() => setZoneKind(zone.id)}
                title={t(zone.hintKey)}
                className={`flex items-center gap-1.5 border px-2 py-1.5 text-left text-xs transition-colors ${
                  on
                    ? "border-accent bg-accent text-white"
                    : "border-divider bg-white hover:border-accent"
                }`}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 flex-none border"
                  style={{
                    borderColor: on ? "#ffffff" : zone.stroke,
                    background: on ? "#ffffff" : `${zone.tint}26`,
                  }}
                />
                <span className="min-w-0 truncate">{t(zone.labelKey)}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          {t(active.hintKey)}
        </p>
        <Button size="sm" className="mt-1.5 w-full" onClick={place}>
          + {t("sidebar.addZone", { zone: t(active.labelKey) })}
        </Button>
      </Block>

      {/* Hämtsidan styr var förslaget på truckzon hamnar. */}
      <Block title={t("sidebar.truckPickup")}>
        <Segmented
          ariaLabel={t("sidebar.truckPickup")}
          value={config.flow.truckPickupSide}
          options={sides}
          onChange={(v) => setFlow({ truckPickupSide: v })}
        />
      </Block>

      <Block title={t("area.tools")}>
        <ToolButtons tools={["measure"]} />
      </Block>

      <Block title={t("area.zones.list")}>
        <DrawnList kinds={["zone"]} empty={t("area.zones.empty")} />
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
      return (
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.sku.toLowerCase().includes(q)
      );
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
            <div className="kicker mb-1">
              {CATEGORY_LABEL[category as MachineCategory]}
            </div>
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
        {Object.keys(grouped).length === 0 ? (
          <Empty>{t("sidebar.noMatch")}</Empty>
        ) : null}
      </div>
    </>
  );
}

function LineArea() {
  const t = useT();
  const {
    config,
    layout,
    selectedId,
    select,
    moveItem,
    removeItem,
    toggleDiagnostics,
  } = useConfigStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const errors = layout.diagnostics.filter(
    (d) => d.severity === "error",
  ).length;
  const warnings = layout.diagnostics.filter(
    (d) => d.severity === "warning",
  ).length;

  return (
    <>
      <Block title={t("area.line.list", { count: config.line.length })}>
        {config.line.length === 0 ? (
          <Empty>{t("area.line.empty")}</Empty>
        ) : (
          <div className="border border-divider">
            {config.line.map((item, index) => {
              const placement = layout.placements.find(
                (p) => p.instanceId === item.instanceId,
              );
              const issues = layout.diagnostics.filter((d) =>
                d.instanceIds.includes(item.instanceId),
              );
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
                    if (dragIndex !== null && dragIndex !== index)
                      moveItem(config.line[dragIndex].instanceId, index);
                    setDragIndex(null);
                  }}
                  onClick={() => select(item.instanceId)}
                  className={`flex cursor-pointer items-center gap-2 border-b border-divider px-2 py-1.5 text-[13px] last:border-0 ${
                    selectedId === item.instanceId
                      ? "bg-accent/10"
                      : "hover:bg-paper"
                  }`}
                >
                  <span className="text-muted">⠿</span>
                  <span className="num w-4 text-muted">
                    {placement?.aux ? "·" : placement?.pos}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {placement?.machine.name ?? item.machineId}
                  </span>
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
          {errors + warnings === 0
            ? t("area.line.clean")
            : t("area.line.issues", { errors, warnings })}
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
        <p className="mb-2 text-[11px] text-muted">
          {t("sidebar.startPointHint")}
        </p>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Field label={t("sidebar.startX")}>
            <NumberInput
              value={meters(config.flow.startPoint.x)}
              onCommit={(raw) => {
                const mm = parseMeters(raw);
                if (mm !== null)
                  setStartPoint({ ...config.flow.startPoint, x: mm });
              }}
            />
          </Field>
          <Field label={t("sidebar.startY")}>
            <NumberInput
              value={meters(config.flow.startPoint.y)}
              onCommit={(raw) => {
                const mm = parseMeters(raw);
                if (mm !== null)
                  setStartPoint({ ...config.flow.startPoint, y: mm });
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
          <Tip
            block
            title={t("points.addStartTip")}
            body={t("points.startHelp")}
          >
            <Button
              size="sm"
              className="w-full"
              disabled={full}
              onClick={() => addFlowMarker("start")}
            >
              {t("points.addStart")}
            </Button>
          </Tip>
          <Tip block title={t("points.addEndTip")} body={t("points.endHelp")}>
            <Button
              size="sm"
              className="w-full"
              disabled={full}
              onClick={() => addFlowMarker("end")}
            >
              {t("points.addEnd")}
            </Button>
          </Tip>
        </div>
      </Block>
    </>
  );
}

function ProductArea() {
  const t = useT();
  const { config, update } = useConfigStore();
  const mm = (
    key:
      | "packageLengthMm"
      | "packageWidthMinMm"
      | "packageWidthMaxMm"
      | "packageHeightMm",
  ) => (
    <NumberInput
      value={meters(config.product[key])}
      suffix="m"
      onCommit={(raw) => {
        const value = parseMeters(raw);
        if (value !== null)
          update((d) => setProductValue(d.product, key, value));
      }}
    />
  );
  const whole = (
    key: "packageWeightKg" | "targetPackagesPerHour",
    suffix: string,
  ) => (
    <NumberInput
      value={String(config.product[key])}
      suffix={suffix}
      step="1"
      onCommit={(raw) => {
        const value = Number(raw.replace(",", "."));
        if (Number.isFinite(value))
          update((d) => setProductValue(d.product, key, value));
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
          <Field label={t("sidebar.packageLength")}>
            {mm("packageLengthMm")}
          </Field>
          <Field label={t("area.product.height")}>
            {mm("packageHeightMm")}
          </Field>
          <Field label={t("area.product.weight")}>
            {whole("packageWeightKg", "kg")}
          </Field>
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
  const { config, layout, setScreen, toggleDiagnostics, update } =
    useConfigStore();
  const errors = layout.diagnostics.filter(
    (d) => d.severity === "error",
  ).length;
  return (
    <>
      {/*
       * Namnet frågas där det börjar betyda något.
       *
       * Fältet i sidhuvudet är samma värde — en genväg för den som vill
       * döpa om på vägen. Men den som aldrig tittar i sidhuvudet ska inte
       * kunna skicka in ett underlag som heter "Nytt projekt", så här står
       * frågan utskriven, med vad namnet används till.
       */}
      <Block title={t("area.quote.name")} help={t("area.quote.nameHelp")}>
        <input
          value={config.projectName}
          onChange={(e) => update((d) => void (d.projectName = e.target.value))}
          placeholder={t("top.projectNamePlaceholder")}
          aria-label={t("top.projectName")}
          className="w-full border border-divider px-2 py-1 text-[13px] outline-none focus:border-accent"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          {t("area.quote.nameHelp")}
        </p>
      </Block>
      <Block title={t("area.quote.summary")}>
        <ul className="space-y-1 text-[12px]">
          <li>{t("area.quote.machines", { count: config.line.length })}</li>
          <li>
            {t("area.quote.hall", {
              l: meters(config.hall.lengthMm),
              w: meters(config.hall.widthMm),
            })}
          </li>
          <li className={errors ? "text-danger" : undefined}>
            {errors
              ? t("area.quote.errors", { count: errors })
              : t("area.quote.noErrors")}
          </li>
        </ul>
        {errors ? (
          <Button
            size="sm"
            className="mt-2"
            onClick={() => toggleDiagnostics(true)}
          >
            {t("area.line.showIssues")}
          </Button>
        ) : null}
      </Block>
      <div className="space-y-2">
        <Button
          variant="primary"
          className="w-full"
          onClick={() => setScreen("quote")}
        >
          {t("guide.quote.go")}
        </Button>
        <ShareButton />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        {t("area.quote.disclaimer")}
      </p>
    </>
  );
}

function ShareButton() {
  const t = useT();
  const config = useConfigStore((s) => s.config);
  const note = useConfigStore((s) => s.note);
  const [state, setState] = useState<"idle" | "copied" | "long" | "failed">(
    "idle",
  );

  const share = async () => {
    const { shareUrl } = await import("@/lib/share");
    const { url, long } = await shareUrl(
      config,
      window.location.origin,
      window.location.pathname,
    );
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
        {state === "idle" || state === "failed"
          ? t("sidebar.share")
          : t("sidebar.shareCopied")}
      </Button>
      {state === "long" ? (
        <p className="mt-1 text-[11px] leading-relaxed text-warn">
          {t("sidebar.shareLong")}
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Hela konfigurationen ligger i länken. Inget sparas på servern, och
          mottagaren behöver inget konto.
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
          if (e.currentTarget.value.trim() !== value)
            onCommit(e.currentTarget.value);
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
        <span
          className={`kicker ${marker.role === "start" ? "text-accent" : "text-steel"}`}
        >
          {label}
        </span>
        <span className="num text-[11px] text-muted">
          {meters(marker.pos.x)} × {meters(marker.pos.y)} m
        </span>
        <span className="ml-auto flex items-center gap-1">
          {marker.role === "start" ? (
            <Tip
              side="right"
              title={t("points.activate")}
              body={t("points.activateTip")}
            >
              <button
                onClick={onActivate}
                className="kicker border border-divider px-1 hover:border-accent hover:text-accent"
              >
                {t("points.activate")}
              </button>
            </Tip>
          ) : null}
          <button
            onClick={onRemove}
            className="text-muted hover:text-danger"
            aria-label="Ta bort"
          >
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
          if (e.currentTarget.value.trim() !== marker.comment)
            onComment(e.currentTarget.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full border border-divider bg-white px-2 py-0.5 text-[12px] outline-none placeholder:text-muted/70 focus:border-accent"
      />
    </div>
  );
}
