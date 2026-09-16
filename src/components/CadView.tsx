"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { isoBounds, isoBox, isoProject, isoUnproject, padBox } from "@/lib/projection";
import { meters } from "@/lib/format";
import { closeCorners, fitDoorToWall, snapToWalls, WALL_THICKNESS_MM } from "@/lib/walls";
import { nextName } from "@/lib/drawing";
import { edgeLabel, edgesFrom, edgesTo } from "@/lib/flowGraph";
import type {
  Box,
  DrawnObject,
  DrawnKind,
  EdgeRun,
  FlowGraph,
  Placement,
  Vec2,
} from "@/lib/types";
import type { FlowAnchor } from "@/store/useConfigStore";
import type { Tool, ViewMode } from "@/store/useConfigStore";

/** Rutnätets delning i planvyn, mm. */
const GRID_MM = 1000;
/** Maskiner snappar till detta raster vid drag, mm. */
const SNAP_MM = 250;
const PAD_MM = 4000;

type Draft = { kind: Exclude<Tool, "select" | "measure" | "flow">; box: Box } | null;

/** CadView ritar plan och isometri; läget "model" hanteras av ModelView. */
type PlanarView = Exclude<ViewMode, "model">;

/** Väggens och portens tjocklek, mm. */

type Measure = { from: Vec2; to: Vec2 } | null;

const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;

/**
 * Väggar och portar låses till närmaste axel så att de alltid blir raka —
 * man drar i grova drag åt det håll man menar och får en ren linje.
 * Truckzoner och no-go-zoner ritas som fria rektanglar.
 */
function draftBox(
  kind: Exclude<Tool, "select" | "measure" | "flow">,
  from: Vec2,
  to: Vec2,
  walls: DrawnObject[] = [],
): Box {
  if (kind === "wall" || kind === "door") {
    // Ändarna dras till befintliga väggar så att linjerna möts där man siktar.
    from = snapToWalls(from, walls);
    to = snapToWalls(to, walls);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const half = WALL_THICKNESS_MM / 2;
    return Math.abs(dx) >= Math.abs(dy)
      ? {
          x: snap(Math.min(from.x, to.x)),
          y: snap(from.y) - half,
          l: Math.max(0, snap(Math.abs(dx))),
          w: WALL_THICKNESS_MM,
        }
      : {
          x: snap(from.x) - half,
          y: snap(Math.min(from.y, to.y)),
          l: WALL_THICKNESS_MM,
          w: Math.max(0, snap(Math.abs(dy))),
        };
  }
  return {
    x: snap(Math.min(from.x, to.x)),
    y: snap(Math.min(from.y, to.y)),
    l: Math.max(0, snap(Math.abs(to.x - from.x))),
    w: Math.max(0, snap(Math.abs(to.y - from.y))),
  };
}

/**
 * Färdigställer det ritade: väggar får sina hörn stängda, portar sätts in i
 * väggen de ritades på. Utan det blir en port en ruta på golvet och ett hörn
 * ett hål på en halv väggtjocklek.
 */
function finishDraft(kind: DrawnKind, box: Box, walls: DrawnObject[]): Box {
  if (kind === "wall") return closeCorners(box, walls);
  if (kind === "door") return fitDoorToWall(box, walls) ?? box;
  return box;
}

export function CadView() {
  const {
    config,
    layout,
    view,
    tool,
    selectedId,
    showZones,
    showPorts,
    select,
    nudge,
    addDrawn,
    setTool,
    drawFlowArrow,
    moveFlowNode,
    selectEdge,
    selectedEdgeId,
    setFlowPoint,
  } = useConfigStore();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const planarView: PlanarView = view === "3d" ? "3d" : "2d";
  const [draft, setDraft] = useState<Draft>(null);
  const [measure, setMeasure] = useState<Measure>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });

  const hallBox: Box = { x: 0, y: 0, l: config.hall.lengthMm, w: config.hall.widthMm };
  const contentBox: Box = useMemo(() => {
    const boxes = [hallBox, layout.bounds];
    for (const d of config.drawn) boxes.push({ x: d.x, y: d.y, l: d.l, w: d.w });
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.l));
    const maxY = Math.max(...boxes.map((b) => b.y + b.w));
    return { x: minX, y: minY, l: maxX - minX, w: maxY - minY };
  }, [hallBox.l, hallBox.w, layout.bounds, config.drawn]);

  const maxHeight = Math.max(config.hall.clearHeightMm, ...layout.placements.map((p) => p.size.heightMm), 1);

  const viewBox = useMemo(() => {
    const base =
      view === "2d" ? padBox(contentBox, PAD_MM) : padBox(isoBounds(contentBox, maxHeight), PAD_MM);
    const cx = base.x + base.l / 2 + pan.x;
    const cy = base.y + base.w / 2 + pan.y;
    const l = base.l / zoom;
    const w = base.w / zoom;
    return { x: cx - l / 2, y: cy - w / 2, l, w };
  }, [contentBox, view, maxHeight, zoom, pan]);

  /** Skärmkoordinat → världskoordinat (mm), via SVG:ns egen transform. */
  const toWorld = useCallback(
    (event: { clientX: number; clientY: number }): Vec2 | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      return planarView === "2d" ? { x: point.x, y: point.y } : isoUnproject(point.x, point.y);
    },
    [planarView],
  );

  /** Pilen medan den dras. */
  const [arrow, setArrow] = useState<{
    from: Vec2;
    to: Vec2;
    overMachine: string | null;
  } | null>(null);

  const strokeUnit = viewBox.l / 900;
  /** Befintliga väggar, som nya väggar och portar fäster mot. */
  const walls = config.drawn.filter((d) => d.kind === "wall");

  /* ── Drag av maskin ──────────────────────────────────────────────────── */
  const startDrag = (placement: Placement, event: React.PointerEvent) => {
    event.stopPropagation();
    select(placement.instanceId);
    if (tool !== "select" || placement.aux === undefined) return;

    const start = toWorld(event);
    if (!start) return;
    let last = { x: 0, y: 0 };

    const move = (e: PointerEvent) => {
      const now = toWorld(e);
      if (!now) return;
      const target = { x: snap(now.x - start.x), y: snap(now.y - start.y) };
      const delta = { x: target.x - last.x, y: target.y - last.y };
      if (delta.x === 0 && delta.y === 0) return;
      last = target;
      nudge(placement.instanceId, delta);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── Dra start- och slutpunkt ────────────────────────────────────────── */
  const dragFlowPoint = (which: "startPoint" | "endPoint", event: React.PointerEvent) => {
    event.stopPropagation();
    if (tool !== "select") return;
    const move = (e: PointerEvent) => {
      const p = toWorld(e);
      if (p) setFlowPoint(which, { x: snap(p.x), y: snap(p.y) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── Rita vägg / no-go / mät ─────────────────────────────────────────── */
  const startGround = (event: React.PointerEvent) => {
    if (tool === "select") {
      select(null);
      return;
    }
    const start = toWorld(event);
    if (!start) return;

    if (tool === "measure") {
      setMeasure({ from: start, to: start });
      const move = (e: PointerEvent) => {
        const now = toWorld(e);
        if (now) setMeasure({ from: start, to: now });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }

    // Flödet ritas i fångstfasen och kommer aldrig hit; resten ritar rutor.
    if (tool === "flow") return;

    const kind = tool;
    const move = (e: PointerEvent) => {
      const now = toWorld(e);
      if (!now) return;
      setDraft({ kind, box: draftBox(kind, start, now, walls) });
    };

    const up = () => {
      setDraft((current) => {
        if (current && current.box.l >= 200 && current.box.w >= 100) {
          const box = finishDraft(current.kind, current.box, walls);
          const object: DrawnObject = {
            id: `${current.kind}-${Date.now().toString(36)}`,
            kind: current.kind,
            name: nextName(current.kind, config.drawn),
            x: Math.round(box.x),
            y: Math.round(box.y),
            l: Math.round(box.l),
            w: Math.round(box.w),
            h: current.kind === "wall" ? 3000 : current.kind === "door" ? 5000 : 0,
          };
          addDrawn(object);
          setTool("select");
        }
        return null;
      });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /*
   * Flödet ritas med en pil, och pilen är hela gränssnittet.
   *
   * Dra från golvet till en maskin: här kommer paket in, och de möter linjen
   * vid den maskinen. Dra från en maskin ut till golvet: härifrån går en väg.
   * Riktningen du drar är paketens riktning — samma sak som pilarna på en
   * handritad flödesskiss betyder. Inga noder att sätta, inga namn att hitta
   * på, inget läge att avsluta: ett drag är en gren, och den är markerad när
   * du släpper, så nästa maskin ur katalogen hamnar på den.
   *
   * Draget tas i fångstfasen eftersom hallen är full av maskiner, truckgator
   * och zoner med egna pekarhanterare. Med pennan i handen finns det bara en
   * sak ett drag kan betyda.
   */
  /**
   * Maskinen under pekaren.
   *
   * Alla element på punkten, inte bara det översta: skelettets egna pilar
   * ligger ovanpå maskinerna och har breda osynliga träffytor, och de skulle
   * annars skymma maskinen man siktar på. Pilen ska fästa i det som faktiskt
   * står i hallen.
   */
  const machineUnder = (clientX: number, clientY: number): string | null => {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const machine = element.closest("[data-machine]")?.getAttribute("data-machine");
      if (machine) return machine;
    }
    return null;
  };

  const captureFlowDrag = (event: React.PointerEvent) => {
    if (tool !== "flow") return;
    event.stopPropagation();
    event.preventDefault();

    const startPoint = toWorld(event);
    if (!startPoint) return;
    const startMachine = machineUnder(event.clientX, event.clientY);
    const from: FlowAnchor = startMachine
      ? { kind: "machine", instanceId: startMachine, at: startPoint }
      : { kind: "point", at: { x: snap(startPoint.x), y: snap(startPoint.y) } };

    setArrow({ from: startPoint, to: startPoint, overMachine: startMachine });

    const move = (e: PointerEvent) => {
      const now = toWorld(e);
      if (!now) return;
      setArrow({ from: startPoint, to: now, overMachine: machineUnder(e.clientX, e.clientY) });
    };

    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setArrow(null);

      const endPoint = toWorld(e);
      if (!endPoint) return;
      // Ett kort drag är ett klick, och ett klick ritar ingen väg.
      if (Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y) < 1500) return;

      const endMachine = machineUnder(e.clientX, e.clientY);
      const to: FlowAnchor = endMachine
        ? { kind: "machine", instanceId: endMachine, at: endPoint }
        : { kind: "point", at: { x: snap(endPoint.x), y: snap(endPoint.y) } };

      drawFlowArrow(from, to);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    setZoom((z) => Math.min(6, Math.max(0.4, z * (event.deltaY < 0 ? 1.12 : 0.89))));
  };

  const fit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const errorIds = new Set(
    layout.diagnostics.filter((d) => d.severity === "error").flatMap((d) => d.instanceIds),
  );
  const warnIds = new Set(
    layout.diagnostics.filter((d) => d.severity === "warning").flatMap((d) => d.instanceIds),
  );

  const fillFor = (p: Placement) => (p.aux ? "#ffffff" : "#f7f7f8");
  const strokeFor = (p: Placement) => {
    if (p.instanceId === selectedId) return "#5980a6";
    if (errorIds.has(p.instanceId)) return "#9f1239";
    if (warnIds.has(p.instanceId)) return "#b45309";
    return "#1d1f20";
  };
  const labelFor = (p: Placement) =>
    p.aux ? p.machine.sku.split("-")[0] : String(p.pos);

  const sorted3d = [...layout.placements].sort(
    (a, b) => isoBox(a.bbox, a.size.heightMm).depth - isoBox(b.bbox, b.size.heightMm).depth,
  );

  const cursor =
    tool === "select" ? "default" : tool === "measure" ? "crosshair" : "crosshair";

  return (
    <div className="relative h-full w-full overflow-hidden bg-paper">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.l} ${viewBox.w}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none select-none"
        style={{ cursor }}
        onWheel={onWheel}
        onPointerDownCapture={captureFlowDrag}
      >
        <defs>
          <pattern
            id="grid"
            width={GRID_MM}
            height={GRID_MM}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M${GRID_MM} 0H0V${GRID_MM}`}
              fill="none"
              stroke="#1d1f20"
              strokeOpacity="0.07"
              strokeWidth={strokeUnit * 0.7}
            />
          </pattern>
          <pattern id="aisleHatch" width="900" height="900" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0v900" stroke="#1d1f20" strokeOpacity="0.14" strokeWidth={strokeUnit * 1.2} />
          </pattern>
          <pattern id="nogoHatch" width="900" height="900" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <path d="M0 0v900" stroke="#9f1239" strokeOpacity="0.4" strokeWidth={strokeUnit * 1.6} />
          </pattern>
          <pattern id="serviceHatch" width="700" height="700" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0v700" stroke="#5980a6" strokeOpacity="0.3" strokeWidth={strokeUnit} />
          </pattern>
        </defs>

        {/* Bakgrund fångar klick för att avmarkera och för ritverktygen. */}
        <rect
          x={viewBox.x}
          y={viewBox.y}
          width={viewBox.l}
          height={viewBox.w}
          fill={view === "2d" ? "url(#grid)" : "#f2f2f3"}
          onPointerDown={startGround}
        />

        {view === "2d" ? (
          <Plan2D
            hallBox={hallBox}
            config={config}
            layout={layout}
            onSelectDrawn={select}
            showZones={showZones}
            showPorts={showPorts}
            strokeUnit={strokeUnit}
            fillFor={fillFor}
            strokeFor={strokeFor}
            labelFor={labelFor}
            onMachineDown={startDrag}
            selectedId={selectedId}
          />
        ) : (
          <Iso3D
            hallBox={hallBox}
            config={config}
            layout={layout}
            sorted={sorted3d}
            strokeUnit={strokeUnit}
            strokeFor={strokeFor}
            labelFor={labelFor}
            onMachineDown={startDrag}
          />
        )}

        <FlowSkeleton
          graph={config.flowGraph}
          runs={layout.edgeRuns}
          view={planarView}
          strokeUnit={strokeUnit}
          selectedEdgeId={selectedEdgeId}
          onEdgeDown={(id, e) => {
            e.stopPropagation();
            selectEdge(id);
          }}
          onNodeDown={(id, e) => {
            // Flödesverktyget tar sina klick i fångstfasen; här handlar det
            // bara om att flytta en nod med markeringsverktyget.
            e.stopPropagation();
            if (tool !== "select") return;
            const move = (ev: PointerEvent) => {
              const p = toWorld(ev);
              if (p) moveFlowNode(id, { x: snap(p.x), y: snap(p.y) });
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />

        {arrow ? <DragArrow arrow={arrow} view={planarView} strokeUnit={strokeUnit} /> : null}

        {draft ? <DraftShape draft={draft} view={planarView} strokeUnit={strokeUnit} /> : null}

        <FlowMarkers
          start={config.flow.startPoint}
          end={config.flow.endPoint}
          lineEnd={layout.metrics.endPointGapMm !== null ? config.flow.endPoint : null}
          view={planarView}
          strokeUnit={strokeUnit}
          onDrag={dragFlowPoint}
        />

        {measure ? <MeasureLine measure={measure} view={planarView} strokeUnit={strokeUnit} /> : null}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between p-2">
        <span className="kicker bg-paper/80 px-1">
          {tool === "flow"
            ? "Dra en pil åt det håll paketen går · från golvet till en maskin = ny inmatning · från en maskin ut = ny väg ut"
            : `${view === "2d" ? "Planvy" : "Isometrisk vy"} · snapp ${SNAP_MM} mm`}
        </span>
        <button
          onClick={fit}
          className="pointer-events-auto kicker border border-divider bg-white px-2 py-1 hover:border-accent"
        >
          Passa in
        </button>
      </div>
    </div>
  );
}

/* ── Planvy ───────────────────────────────────────────────────────────── */

function Plan2D({
  hallBox,
  config,
  layout,
  showZones,
  showPorts,
  strokeUnit,
  fillFor,
  strokeFor,
  labelFor,
  onMachineDown,
  onSelectDrawn,
  selectedId,
}: {
  hallBox: Box;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  layout: ReturnType<typeof useConfigStore.getState>["layout"];
  showZones: boolean;
  showPorts: boolean;
  strokeUnit: number;
  fillFor: (p: Placement) => string;
  strokeFor: (p: Placement) => string;
  labelFor: (p: Placement) => string;
  onMachineDown: (p: Placement, e: React.PointerEvent) => void;
  onSelectDrawn: (id: string) => void;
  selectedId: string | null;
}) {
  const bounds = layout.bounds;

  return (
    <g>
      <rect
        x={hallBox.x}
        y={hallBox.y}
        width={hallBox.l}
        height={hallBox.w}
        fill="none"
        stroke="#1d1f20"
        strokeOpacity="0.5"
        strokeWidth={strokeUnit * 1.4}
        strokeDasharray={`${strokeUnit * 12} ${strokeUnit * 5} ${strokeUnit * 3} ${strokeUnit * 5}`}
      />
      <text
        x={hallBox.x + 400}
        y={hallBox.y - 500}
        fontSize={strokeUnit * 16}
        fill="#1d1f20"
        fillOpacity="0.55"
        className="num"
      >
        HALL {meters(config.hall.lengthMm)} × {meters(config.hall.widthMm)} m · fri höjd{" "}
        {meters(config.hall.clearHeightMm)} m
      </text>

      {config.drawn.map((d) => (
        <DrawnShape
          key={d.id}
          object={d}
          selected={d.id === selectedId}
          strokeUnit={strokeUnit}
          onSelect={onSelectDrawn}
        />
      ))}

      {showZones
        ? layout.placements.flatMap((p) =>
            p.zones.map((z, i) => (
              <rect
                key={`${p.instanceId}-z${i}`}
                x={z.box.x}
                y={z.box.y}
                width={z.box.l}
                height={z.box.w}
                fill={z.type === "service" ? "url(#serviceHatch)" : "none"}
                stroke={z.type === "safety" ? "#b45309" : "#5980a6"}
                strokeOpacity="0.45"
                strokeWidth={strokeUnit}
                strokeDasharray={`${strokeUnit * 4} ${strokeUnit * 3}`}
                pointerEvents="none"
              />
            )),
          )
        : null}

      {layout.placements.map((p) => (
        <g
          key={p.instanceId}
          data-machine={p.instanceId}
          onPointerDown={(e) => onMachineDown(p, e)}
          style={{ cursor: "grab" }}
        >
          <rect
            x={p.bbox.x}
            y={p.bbox.y}
            width={p.bbox.l}
            height={p.bbox.w}
            fill={fillFor(p)}
            stroke={strokeFor(p)}
            strokeWidth={strokeUnit * (p.instanceId === selectedId ? 2.6 : 1.4)}
            strokeDasharray={p.aux ? `${strokeUnit * 6} ${strokeUnit * 4}` : undefined}
          />
          <text
            x={p.bbox.x + p.bbox.l / 2}
            y={p.bbox.y + p.bbox.w / 2 + strokeUnit * 7}
            textAnchor="middle"
            fontSize={strokeUnit * (p.aux ? 14 : 20)}
            fill="#1d1f20"
            className="num"
            pointerEvents="none"
          >
            {labelFor(p)}
          </text>
        </g>
      ))}

      {showPorts
        ? layout.placements.flatMap((p) =>
            p.ports.map((port) => (
              <circle
                key={`${p.instanceId}-${port.id}`}
                cx={port.pos.x}
                cy={port.pos.y}
                r={strokeUnit * 4}
                fill={port.role === "in" ? "#5980a6" : "#1d2d3d"}
                pointerEvents="none"
              />
            )),
          )
        : null}

      {bounds.l > 0 ? (
        <g pointerEvents="none">
          <path
            d={`M${bounds.x} ${bounds.y - 2200}v900M${bounds.x + bounds.l} ${bounds.y - 2200}v900M${bounds.x} ${bounds.y - 1750}h${bounds.l}`}
            stroke="#1d1f20"
            strokeOpacity="0.45"
            strokeWidth={strokeUnit}
            fill="none"
          />
          <text
            x={bounds.x + bounds.l / 2}
            y={bounds.y - 2400}
            textAnchor="middle"
            fontSize={strokeUnit * 18}
            fill="#1d1f20"
            fillOpacity="0.7"
            className="num"
          >
            {meters(bounds.l)} m
          </text>
        </g>
      ) : null}

      <DiagnosticBadges layout={layout} strokeUnit={strokeUnit} project={(v) => v} />
    </g>
  );
}

/* ── Isometrisk vy ────────────────────────────────────────────────────── */

function Iso3D({
  hallBox,
  config,
  layout,
  sorted,
  strokeUnit,
  strokeFor,
  labelFor,
  onMachineDown,
}: {
  hallBox: Box;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  layout: ReturnType<typeof useConfigStore.getState>["layout"];
  sorted: Placement[];
  strokeUnit: number;
  strokeFor: (p: Placement) => string;
  labelFor: (p: Placement) => string;
  onMachineDown: (p: Placement, e: React.PointerEvent) => void;
}) {
  const floor = [
    [hallBox.x, hallBox.y],
    [hallBox.x + hallBox.l, hallBox.y],
    [hallBox.x + hallBox.l, hallBox.y + hallBox.w],
    [hallBox.x, hallBox.y + hallBox.w],
  ]
    .map(([a, b]) => {
      const p = isoProject(a, b, 0);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");

  const gridLines: string[] = [];
  for (let x = hallBox.x; x <= hallBox.x + hallBox.l; x += 2000) {
    const a = isoProject(x, hallBox.y, 0);
    const b = isoProject(x, hallBox.y + hallBox.w, 0);
    gridLines.push(`M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
  }
  for (let y = hallBox.y; y <= hallBox.y + hallBox.w; y += 2000) {
    const a = isoProject(hallBox.x, y, 0);
    const b = isoProject(hallBox.x + hallBox.l, y, 0);
    gridLines.push(`M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
  }

  return (
    <g>
      <polygon
        points={floor}
        fill="#eff0f1"
        stroke="#1d1f20"
        strokeOpacity="0.45"
        strokeWidth={strokeUnit * 1.4}
        strokeDasharray={`${strokeUnit * 12} ${strokeUnit * 5} ${strokeUnit * 3} ${strokeUnit * 5}`}
      />
      <g stroke="#1d1f20" strokeOpacity="0.1" strokeWidth={strokeUnit * 0.8} fill="none">
        {gridLines.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {config.drawn.map((d) => {
        const faces = isoBox({ x: d.x, y: d.y, l: d.l, w: d.w }, d.h || 1);

        // Markering (höjd noll): ligger på golvet i stället för att resa sig.
        if ((d.kind === "wall" || d.kind === "door") && d.h === 0) {
          return (
            <polygon
              key={d.id}
              points={faces.top}
              fill={d.kind === "door" ? "#5980a6" : "#1d1f20"}
              fillOpacity={d.kind === "door" ? 0.18 : 0.1}
              stroke={d.kind === "door" ? "#5980a6" : "#1d1f20"}
              strokeOpacity="0.75"
              strokeWidth={strokeUnit * 1.4}
              strokeDasharray={`${strokeUnit * 7} ${strokeUnit * 4}`}
            />
          );
        }

        if (d.kind === "wall") {
          return (
            <g key={d.id}>
              <polygon points={faces.right} fill="#bdbdc0" stroke="#1d1f20" strokeWidth={strokeUnit} />
              <polygon points={faces.left} fill="#cfcfd2" stroke="#1d1f20" strokeWidth={strokeUnit} />
              <polygon points={faces.top} fill="#e7e7ea" stroke="#1d1f20" strokeWidth={strokeUnit} />
            </g>
          );
        }
        if (d.kind === "door") {
          return (
            <g key={d.id}>
              <polygon points={faces.right} fill="#5980a6" fillOpacity="0.35" stroke="#5980a6" strokeWidth={strokeUnit} />
              <polygon points={faces.left} fill="#5980a6" fillOpacity="0.25" stroke="#5980a6" strokeWidth={strokeUnit} />
              <polygon points={faces.top} fill="#5980a6" fillOpacity="0.15" stroke="#5980a6" strokeWidth={strokeUnit} />
            </g>
          );
        }
        return (
          <polygon
            key={d.id}
            points={faces.top}
            fill={d.kind === "truck" ? "url(#aisleHatch)" : "url(#nogoHatch)"}
            stroke={d.kind === "truck" ? "#1d1f20" : "#9f1239"}
            strokeOpacity="0.5"
            strokeWidth={strokeUnit}
            strokeDasharray={`${strokeUnit * 5} ${strokeUnit * 3}`}
          />
        );
      })}

      {sorted.map((p) => {
        const faces = isoBox(p.bbox, p.size.heightMm);
        const stroke = strokeFor(p);
        return (
          <g
          key={p.instanceId}
          data-machine={p.instanceId}
          onPointerDown={(e) => onMachineDown(p, e)}
          style={{ cursor: "grab" }}
        >
            <polygon
              points={faces.right}
              fill={p.aux ? "#e7e7ea" : "#d9d9dd"}
              stroke={stroke}
              strokeWidth={strokeUnit * 1.2}
            />
            <polygon
              points={faces.left}
              fill={p.aux ? "#efeff1" : "#e7e7ea"}
              stroke={stroke}
              strokeWidth={strokeUnit * 1.2}
            />
            <polygon
              points={faces.top}
              fill={p.aux ? "#fbfbfc" : "#f5f5f8"}
              stroke={stroke}
              strokeWidth={strokeUnit * 1.4}
              strokeDasharray={p.aux ? `${strokeUnit * 5} ${strokeUnit * 3}` : undefined}
            />
            <text
              x={faces.center.x}
              y={faces.center.y + strokeUnit * 6}
              textAnchor="middle"
              fontSize={strokeUnit * (p.aux ? 13 : 18)}
              fill="#1d1f20"
              className="num"
              pointerEvents="none"
            >
              {labelFor(p)}
            </text>
          </g>
        );
      })}

      <DiagnosticBadges
        layout={layout}
        strokeUnit={strokeUnit}
        project={(v) => isoProject(v.x, v.y, 0)}
      />
    </g>
  );
}

/* ── Diagnostik förankrad i geometrin ─────────────────────────────────── */

function DiagnosticBadges({
  layout,
  strokeUnit,
  project,
}: {
  layout: ReturnType<typeof useConfigStore.getState>["layout"];
  strokeUnit: number;
  project: (v: Vec2) => Vec2;
}) {
  const toggleDiagnostics = useConfigStore((s) => s.toggleDiagnostics);
  const select = useConfigStore((s) => s.select);

  const anchored = layout.diagnostics.filter((d) => d.anchor && d.severity !== "info").slice(0, 8);

  return (
    <g>
      {anchored.map((d, i) => {
        const p = project(d.anchor!);
        const isError = d.severity === "error";
        const width = strokeUnit * 44;
        const height = strokeUnit * 22;
        return (
          <g
            key={`${d.code}-${i}`}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (d.instanceIds[0]) select(d.instanceIds[0]);
              toggleDiagnostics(true);
            }}
          >
            <rect
              x={p.x - width / 2}
              y={p.y - height / 2}
              width={width}
              height={height}
              fill={isError ? "#9f1239" : "#b45309"}
            />
            <text
              x={p.x}
              y={p.y + strokeUnit * 6}
              textAnchor="middle"
              fontSize={strokeUnit * 13}
              fill="#ffffff"
              className="num"
              pointerEvents="none"
            >
              {d.code}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Ett ritat objekt i planvyn. Varje typ har sitt eget uttryck. */
function DrawnShape({
  object,
  selected,
  strokeUnit,
  onSelect,
}: {
  object: DrawnObject;
  selected: boolean;
  strokeUnit: number;
  onSelect: (id: string) => void;
}) {
  const style = {
    wall: { fill: "#d4d4d7", stroke: "#1d1f20", dash: undefined as string | undefined },
    door: { fill: "#ffffff", stroke: "#5980a6", dash: undefined },
    truck: { fill: "url(#aisleHatch)", stroke: "#1d1f20", dash: `${strokeUnit * 6} ${strokeUnit * 4}` },
    nogo: { fill: "url(#nogoHatch)", stroke: "#9f1239", dash: `${strokeUnit * 5} ${strokeUnit * 3}` },
  }[object.kind];

  const cx = object.x + object.l / 2;
  const cy = object.y + object.w / 2;
  const alongX = object.l >= object.w;

  /*
   * Höjd noll är en markering, inte en byggd vägg: så kommer väggarna ur en
   * uppläst kundritning. Den ritas som en streckad linje där väggen går, som
   * på ritningen den kommer ifrån — en fylld mur i planvyn påstår mer om
   * lokalen än underlaget gör.
   */
  const marked = object.kind === "wall" && object.h === 0;

  return (
    <g
      style={{ cursor: "pointer" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(object.id);
      }}
    >
      <rect
        x={object.x}
        y={object.y}
        width={object.l}
        height={object.w}
        fill={marked ? "#1d1f20" : style.fill}
        fillOpacity={marked ? 0.05 : undefined}
        stroke={marked ? "none" : selected ? "#5980a6" : style.stroke}
        strokeOpacity={object.kind === "truck" ? 0.45 : 1}
        strokeWidth={strokeUnit * (selected ? 2.4 : 1.2)}
        strokeDasharray={style.dash}
      />

      {marked ? (
        <path
          d={alongX ? `M${object.x} ${cy}h${object.l}` : `M${cx} ${object.y}v${object.w}`}
          stroke={selected ? "#5980a6" : "#1d1f20"}
          strokeWidth={strokeUnit * (selected ? 2.6 : 1.8)}
          strokeDasharray={`${strokeUnit * 9} ${strokeUnit * 5}`}
          strokeLinecap="round"
          fill="none"
        />
      ) : null}

      {/* Porten ritas som en öppning: streckad tröskel tvärs väggen. */}
      {object.kind === "door" ? (
        <path
          d={
            alongX
              ? `M${object.x} ${cy}h${object.l}`
              : `M${cx} ${object.y}v${object.w}`
          }
          stroke="#5980a6"
          strokeWidth={strokeUnit * 2}
          strokeDasharray={`${strokeUnit * 4} ${strokeUnit * 3}`}
        />
      ) : null}

      {object.kind === "truck" || object.kind === "door" ? (
        <text
          x={cx}
          y={object.kind === "door" ? object.y - strokeUnit * 5 : cy + strokeUnit * 6}
          textAnchor="middle"
          fontSize={strokeUnit * (object.kind === "door" ? 13 : 16)}
          letterSpacing={strokeUnit}
          fill={object.kind === "door" ? "#5980a6" : "#1d1f20"}
          fillOpacity={object.kind === "door" ? 1 : 0.6}
          className="num"
          pointerEvents="none"
        >
          {object.name.toUpperCase()}
        </text>
      ) : null}
    </g>
  );
}

/** Utkastet medan man drar, med måttet utskrivet. */
function DraftShape({
  draft,
  view,
  strokeUnit,
}: {
  draft: NonNullable<Draft>;
  view: PlanarView;
  strokeUnit: number;
}) {
  const { box } = draft;
  const alongX = box.l >= box.w;
  const label =
    draft.kind === "wall" || draft.kind === "door"
      ? `${meters(alongX ? box.l : box.w)} m`
      : `${meters(box.l)} × ${meters(box.w)} m`;
  const center = view === "2d"
    ? { x: box.x + box.l / 2, y: box.y + box.w / 2 }
    : isoProject(box.x + box.l / 2, box.y + box.w / 2, 0);

  return (
    <g pointerEvents="none">
      {view === "2d" ? (
        <rect
          x={box.x}
          y={box.y}
          width={box.l}
          height={box.w}
          fill="#5980a6"
          fillOpacity="0.12"
          stroke="#5980a6"
          strokeWidth={strokeUnit * 2}
          strokeDasharray={`${strokeUnit * 6} ${strokeUnit * 4}`}
        />
      ) : (
        <polygon
          points={isoBox(box, 1).top}
          fill="#5980a6"
          fillOpacity="0.12"
          stroke="#5980a6"
          strokeWidth={strokeUnit * 2}
          strokeDasharray={`${strokeUnit * 6} ${strokeUnit * 4}`}
        />
      )}
      <rect
        x={center.x - strokeUnit * 32}
        y={center.y - strokeUnit * 12}
        width={strokeUnit * 64}
        height={strokeUnit * 20}
        fill="#ffffff"
        stroke="#5980a6"
        strokeWidth={strokeUnit}
      />
      <text
        x={center.x}
        y={center.y + strokeUnit * 2}
        textAnchor="middle"
        fontSize={strokeUnit * 13}
        fill="#1d1f20"
        className="num"
      >
        {label}
      </text>
    </g>
  );
}

/** Start- och slutpunkt som dragbara markörer i ritningen. */
function FlowMarkers({
  start,
  end,
  view,
  strokeUnit,
  onDrag,
}: {
  start: Vec2;
  end: Vec2 | null;
  lineEnd: Vec2 | null;
  view: PlanarView;
  strokeUnit: number;
  onDrag: (which: "startPoint" | "endPoint", event: React.PointerEvent) => void;
}) {
  const project = (v: Vec2) => (view === "2d" ? v : isoProject(v.x, v.y, 0));
  const a = project(start);
  const r = strokeUnit * 9;

  return (
    <g>
      <g
        style={{ cursor: "grab" }}
        onPointerDown={(e) => onDrag("startPoint", e)}
      >
        <circle cx={a.x} cy={a.y} r={r} fill="#5980a6" fillOpacity="0.18" stroke="#5980a6" strokeWidth={strokeUnit * 1.6} />
        <circle cx={a.x} cy={a.y} r={strokeUnit * 2.4} fill="#5980a6" />
        <text
          x={a.x}
          y={a.y - r - strokeUnit * 4}
          textAnchor="middle"
          fontSize={strokeUnit * 12}
          fill="#5980a6"
          className="num"
          pointerEvents="none"
        >
          START
        </text>
      </g>

      {end ? (
        <g style={{ cursor: "grab" }} onPointerDown={(e) => onDrag("endPoint", e)}>
          {(() => {
            const b = project(end);
            return (
              <>
                <circle
                  cx={b.x}
                  cy={b.y}
                  r={r}
                  fill="#1d2d3d"
                  fillOpacity="0.12"
                  stroke="#1d2d3d"
                  strokeWidth={strokeUnit * 1.6}
                />
                <path
                  d={`M${b.x - r} ${b.y}h${r * 2}M${b.x} ${b.y - r}v${r * 2}`}
                  stroke="#1d2d3d"
                  strokeWidth={strokeUnit * 1.4}
                />
                <text
                  x={b.x}
                  y={b.y - r - strokeUnit * 4}
                  textAnchor="middle"
                  fontSize={strokeUnit * 12}
                  fill="#1d2d3d"
                  className="num"
                  pointerEvents="none"
                >
                  SLUT
                </text>
              </>
            );
          })()}
        </g>
      ) : null}
    </g>
  );
}

function MeasureLine({
  measure,
  view,
  strokeUnit,
}: {
  measure: NonNullable<Measure>;
  view: PlanarView;
  strokeUnit: number;
}) {
  const project = (v: Vec2) => (view === "2d" ? v : isoProject(v.x, v.y, 0));
  const a = project(measure.from);
  const b = project(measure.to);
  const distance = Math.hypot(measure.to.x - measure.from.x, measure.to.y - measure.from.y);

  return (
    <g pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5980a6" strokeWidth={strokeUnit * 1.6} />
      <circle cx={a.x} cy={a.y} r={strokeUnit * 3} fill="#5980a6" />
      <circle cx={b.x} cy={b.y} r={strokeUnit * 3} fill="#5980a6" />
      <rect
        x={(a.x + b.x) / 2 - strokeUnit * 26}
        y={(a.y + b.y) / 2 - strokeUnit * 14}
        width={strokeUnit * 52}
        height={strokeUnit * 20}
        fill="#ffffff"
        stroke="#5980a6"
        strokeWidth={strokeUnit}
      />
      <text
        x={(a.x + b.x) / 2}
        y={(a.y + b.y) / 2}
        textAnchor="middle"
        fontSize={strokeUnit * 14}
        fill="#1d1f20"
        className="num"
      >
        {meters(distance)} m
      </text>
    </g>
  );
}

/**
 * Flödesskelettet i planvyn.
 *
 * Noderna är punkter kunden satt, sträckorna pilarna mellan dem. Det ritas
 * ovanpå maskinerna med flit: skelettet är avsikten, och när maskinerna inte
 * följer den ska det synas att de inte gör det. Pilen pekar åt det håll
 * paketen går, precis som pilarna på en handritad flödesskiss.
 */
function FlowSkeleton({
  graph,
  runs,
  view,
  strokeUnit,
  selectedEdgeId,
  onEdgeDown,
  onNodeDown,
}: {
  graph: FlowGraph | undefined;
  runs: EdgeRun[];
  view: PlanarView;
  strokeUnit: number;
  selectedEdgeId: string | null;
  onEdgeDown: (edgeId: string, event: React.PointerEvent) => void;
  onNodeDown: (nodeId: string, event: React.PointerEvent) => void;
}) {
  if (!graph || graph.nodes.length === 0) return null;

  const project = (v: Vec2) => (view === "2d" ? v : isoProject(v.x, v.y, 0));
  const nodeAt = (id: string | null) => graph.nodes.find((n) => n.id === id);
  const r = strokeUnit * 7;
  const runFor = new Map(runs.map((run) => [run.edgeId, run]));

  /**
   * Var en ände faktiskt ligger.
   *
   * Du ritar riktningen; maskinerna bestämmer längden. En fri ände följer
   * därför med dit maskinerna slutar, i stället för att stå kvar där pilen
   * råkade släppas och påstå att det fattas trettio meter. En ände som något
   * annat hänger i står kvar — där är punkten en överenskommelse mellan två
   * grenar, och då är glappet något att säga till om.
   */
  const free = (nodeId: string) =>
    edgesTo(graph, nodeId).length + edgesFrom(graph, nodeId).length <= 1;

  const positionOf = (nodeId: string): Vec2 => {
    const node = nodeAt(nodeId)!;
    if (!free(nodeId)) return node.at;
    const incoming = edgesTo(graph, nodeId)[0];
    const run = incoming ? runFor.get(incoming.id) : undefined;
    return run?.end?.point ?? node.at;
  };

  return (
    <g>
      {graph.edges.map((edge) => {
        const from = nodeAt(edge.fromNodeId);
        const to = nodeAt(edge.toNodeId);
        if (!from || !to) return null;

        const a = project(positionOf(from.id));
        const b = project(positionOf(to.id));
        const selected = edge.id === selectedEdgeId;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // Pilen slutar utanför noden så att spetsen syns bredvid ringen.
        const ux = dx / len;
        const uy = dy / len;
        const tip = { x: b.x - ux * r * 1.6, y: b.y - uy * r * 1.6 };
        const tail = { x: a.x + ux * r * 1.6, y: a.y + uy * r * 1.6 };
        const head = strokeUnit * 6;

        return (
          <g
            key={edge.id}
            onPointerDown={(e) => onEdgeDown(edge.id, e)}
            style={{ cursor: "pointer" }}
          >
            {/* Bred osynlig linje så att sträckan går att träffa med musen. */}
            <line
              x1={tail.x}
              y1={tail.y}
              x2={tip.x}
              y2={tip.y}
              stroke="transparent"
              strokeWidth={strokeUnit * 14}
            />
            <line
              x1={tail.x}
              y1={tail.y}
              x2={tip.x}
              y2={tip.y}
              stroke={selected ? "#5980a6" : "#c8a020"}
              strokeWidth={strokeUnit * (selected ? 3.4 : 2.4)}
              strokeLinecap="round"
            />
            <path
              d={`M ${tip.x} ${tip.y} L ${tip.x - ux * head + -uy * head * 0.5} ${
                tip.y - uy * head + ux * head * 0.5
              } L ${tip.x - ux * head + uy * head * 0.5} ${tip.y - uy * head - ux * head * 0.5} Z`}
              fill={selected ? "#5980a6" : "#c8a020"}
            />
            <text
              x={(tail.x + tip.x) / 2}
              y={(tail.y + tip.y) / 2 - strokeUnit * 4}
              textAnchor="middle"
              fontSize={strokeUnit * 11}
              fill={selected ? "#5980a6" : "#8a6f16"}
            >
              {edgeLabel(graph, edge)}
            </text>
          </g>
        );
      })}

      {graph.nodes.map((node) => {
        const p = project(positionOf(node.id));
        // Var flödet börjar och slutar är värt en ring med namn. Ett möte mitt
        // i linjen är bara en punkt — den behöver inte döpas för att förstås.
        const ends = edgesTo(graph, node.id).length === 0 || edgesFrom(graph, node.id).length === 0;
        const infeed = edgesTo(graph, node.id).length === 0;
        const fill = infeed ? "#2f7a4f" : ends ? "#9f1239" : "#c8a020";

        return (
          <g
            key={node.id}
            data-flow-node={node.id}
            onPointerDown={(e) => onNodeDown(node.id, e)}
            style={{ cursor: "grab" }}
          >
            {ends ? (
              <>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={fill}
                  fillOpacity={0.18}
                  stroke={fill}
                  strokeWidth={strokeUnit * 1.6}
                />
                <text
                  x={p.x}
                  y={p.y - r - strokeUnit * 3}
                  textAnchor="middle"
                  fontSize={strokeUnit * 11}
                  fill={fill}
                >
                  {infeed ? "Paket in" : "Paket ut"}
                </text>
              </>
            ) : (
              <rect
                x={p.x - strokeUnit * 3}
                y={p.y - strokeUnit * 3}
                width={strokeUnit * 6}
                height={strokeUnit * 6}
                transform={`rotate(45 ${p.x} ${p.y})`}
                fill={fill}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}


/** Pilen medan den dras — samma gula som skelettet, och en spets som pekar. */
function DragArrow({
  arrow,
  view,
  strokeUnit,
}: {
  arrow: { from: Vec2; to: Vec2; overMachine: string | null };
  view: PlanarView;
  strokeUnit: number;
}) {
  const project = (v: Vec2) => (view === "2d" ? v : isoProject(v.x, v.y, 0));
  const a = project(arrow.from);
  const b = project(arrow.to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = strokeUnit * 7;
  const colour = arrow.overMachine ? "#5980a6" : "#c8a020";

  return (
    <g pointerEvents="none">
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={colour}
        strokeWidth={strokeUnit * 3}
        strokeLinecap="round"
        strokeDasharray={`${strokeUnit * 6} ${strokeUnit * 4}`}
      />
      <path
        d={`M ${b.x} ${b.y} L ${b.x - ux * head - uy * head * 0.5} ${
          b.y - uy * head + ux * head * 0.5
        } L ${b.x - ux * head + uy * head * 0.5} ${b.y - uy * head - ux * head * 0.5} Z`}
        fill={colour}
      />
      <circle cx={a.x} cy={a.y} r={strokeUnit * 2.5} fill={colour} />
    </g>
  );
}
