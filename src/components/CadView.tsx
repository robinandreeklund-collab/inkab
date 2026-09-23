"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { padBox } from "@/lib/projection";
import { meters } from "@/lib/format";
import { closeCorners, fitDoorToWall, snapToWalls, WALL_THICKNESS_MM } from "@/lib/walls";
import { nextName } from "@/lib/drawing";
import { ROTATE_ARC, ROTATE_TIP } from "./ui";
import type { Box, DrawnObject, DrawnKind, PlacedPort, Placement, Vec2 } from "@/lib/types";
import type { Tool, ViewMode } from "@/store/useConfigStore";
import { DIR_VEC } from "@/lib/geometry";

/** Rutnätets delning i planvyn, mm. */
const GRID_MM = 1000;
/** Maskiner snappar till detta raster vid drag, mm. */
const SNAP_MM = 250;
const PAD_MM = 4000;

type Draft = { kind: Exclude<Tool, "select" | "measure">; box: Box } | null;

/** Väggens och portens tjocklek, mm. */

type Measure = { from: Vec2; to: Vec2 } | null;

const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;

/**
 * Väggar och portar låses till närmaste axel så att de alltid blir raka —
 * man drar i grova drag åt det håll man menar och får en ren linje.
 * Truckzoner och no-go-zoner ritas som fria rektanglar.
 */
function draftBox(
  kind: Exclude<Tool, "select" | "measure">,
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
    moveMachine,
    turnMachine,
    updateDrawn,
    turnDrawn,
    addDrawn,
    setTool,
    setFlowPoint,
  } = useConfigStore();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [measure, setMeasure] = useState<Measure>(null);
  /*
   * Utsnittet som gällde när ett drag började.
   *
   * Vyn ramar in allt som finns i hallen, så den räknas om när en maskin
   * flyttas — och då glider ritningen under pekaren mitt i draget. Maskinen
   * drev i sidled fast man bara drog neråt. Under ett drag står utsnittet
   * still och släpps när man släpper.
   */
  const [frozen, setFrozen] = useState<Box | null>(null);
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

  const viewBox = useMemo(() => {
    const framed = frozen ?? contentBox;
    const base = padBox(framed, PAD_MM);
    const cx = base.x + base.l / 2 + pan.x;
    const cy = base.y + base.w / 2 + pan.y;
    const l = base.l / zoom;
    const w = base.w / zoom;
    return { x: cx - l / 2, y: cy - w / 2, l, w };
  }, [contentBox, frozen, zoom, pan]);

  /** Skärmkoordinat → världskoordinat (mm), via SVG:ns egen transform. */
  const toWorld = useCallback(
    (event: { clientX: number; clientY: number }): Vec2 | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      return { x: point.x, y: point.y };
    },
    [],
  );

  const strokeUnit = viewBox.l / 900;
  /** Befintliga väggar, som nya väggar och portar fäster mot. */
  const walls = config.drawn.filter((d) => d.kind === "wall");

  /* ── Drag av maskin ──────────────────────────────────────────────────── */
  const startDrag = (placement: Placement, event: React.PointerEvent) => {
    event.stopPropagation();
    select(placement.instanceId);
    if (tool !== "select") return;

    /*
     * Koordinatsystemet låses vid draget.
     *
     * toWorld frågar SVG:n om dess transform varje gång. Den ändras mitt i
     * draget — vyn ramar om sig, panelen öppnas — och då betyder samma punkt
     * på skärmen olika punkter i hallen från ett ögonblick till nästa.
     * Maskinen drev i sidled fast man bara drog neråt. Med matrisen från
     * nedtryckningen följer maskinen pekaren.
     */
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return;
    const frozenInverse = ctm.inverse();
    const at = (e: { clientX: number; clientY: number }): Vec2 => {
      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(frozenInverse);
      return { x: point.x, y: point.y };
    };

    const start = at(event);
    /*
     * Positionen sätts absolut, inte som en förskjutning. Maskinen står där
     * den står — den räknas inte fram ur något annat — så draget behöver
     * inte veta vad den hade för utgångsläge, bara var den hamnar.
     */
    const origin = { ...placement.origin };
    setFrozen(contentBox);

    const move = (e: PointerEvent) => {
      const now = at(e);
      moveMachine(placement.instanceId, {
        x: snap(origin.x + (now.x - start.x)),
        y: snap(origin.y + (now.y - start.y)),
      });
    };
    const up = () => {
      setFrozen(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── Drag av ritat objekt ────────────────────────────────────────────── */
  const startDragDrawn = (object: DrawnObject, event: React.PointerEvent) => {
    event.stopPropagation();
    select(object.id);
    if (tool !== "select") return;

    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return;
    const frozenInverse = ctm.inverse();
    const at = (e: { clientX: number; clientY: number }): Vec2 => {
      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(frozenInverse);
      return { x: point.x, y: point.y };
    };

    const start = at(event);
    const from = { x: object.x, y: object.y };
    setFrozen(contentBox);
    let senaste = from;

    const move = (e: PointerEvent) => {
      const now = at(e);
      senaste = {
        x: snap(from.x + (now.x - start.x)),
        y: snap(from.y + (now.y - start.y)),
      };
      updateDrawn(object.id, senaste);
    };
    const up = () => {
      setFrozen(null);
      /*
       * En port hör till en vägg. Släpps den i närheten av en söker den upp
       * väggen igen — annars blir den en ruta på golvet, vilket är precis
       * vad fitDoorToWall finns för när man ritar den.
       */
      if (object.kind === "door") {
        const box = fitDoorToWall({ ...senaste, l: object.l, w: object.w }, walls);
        if (box) updateDrawn(object.id, box);
      }
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
          fill="url(#grid)"
          onPointerDown={startGround}
        />

          <Plan2D
            hallBox={hallBox}
            config={config}
            layout={layout}
            onDrawnDown={startDragDrawn}
            onTurnDrawn={turnDrawn}
            showZones={showZones}
            showPorts={showPorts}
            strokeUnit={strokeUnit}
            fillFor={fillFor}
            strokeFor={strokeFor}
            labelFor={labelFor}
            onMachineDown={startDrag}
            onTurn={turnMachine}
            selectedId={selectedId}
          />

        {draft ? <DraftShape draft={draft} strokeUnit={strokeUnit} /> : null}

        <FlowMarkers
          start={config.flow.startPoint}
          end={null}
          lineEnd={null}
          strokeUnit={strokeUnit}
          onDrag={dragFlowPoint}
        />

        {measure ? <MeasureLine measure={measure} strokeUnit={strokeUnit} /> : null}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between p-2">
        <span className="kicker bg-paper/80 px-1">
          Planvy · snapp {SNAP_MM} mm
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
  onTurn,
  onDrawnDown,
  onTurnDrawn,
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
  onTurn: (instanceId: string, steps: number) => void;
  onDrawnDown: (o: DrawnObject, e: React.PointerEvent) => void;
  onTurnDrawn: (id: string) => void;
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
          onDown={onDrawnDown}
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
        <g key={p.instanceId} onPointerDown={(e) => onMachineDown(p, e)} style={{ cursor: "grab" }}>
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

      {(() => {
        const maskin = layout.placements.find((p) => p.instanceId === selectedId);
        if (maskin) {
          return (
            <TurnHandle
              box={maskin.bbox}
              strokeUnit={strokeUnit}
              onTurn={(steps) => onTurn(maskin.instanceId, steps)}
            />
          );
        }
        const ritat = config.drawn.find((d) => d.id === selectedId);
        return ritat ? (
          <TurnHandle
            box={{ x: ritat.x, y: ritat.y, l: ritat.l, w: ritat.w }}
            strokeUnit={strokeUnit}
            onTurn={() => onTurnDrawn(ritat.id)}
          />
        ) : null;
      })()}

      {showPorts
        ? layout.placements.flatMap((p) =>
            p.ports.map((port) => (
              <FlowArrow
                key={`${p.instanceId}-${port.id}`}
                port={port}
                strokeUnit={strokeUnit}
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
          /*
           * Brickan är en markering, inte en knapp. Den sitter mitt på den
           * maskin den handlar om, och fångade den pekaren gick maskinen inte
           * att dra — man tog tag mitt i den och ingenting hände. Felen nås
           * i diagnostikpanelen; att peka på maskinen räcker här.
           */
          <g key={`${d.code}-${i}`} pointerEvents="none">
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
  onDown,
}: {
  object: DrawnObject;
  selected: boolean;
  strokeUnit: number;
  onDown: (o: DrawnObject, e: React.PointerEvent) => void;
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
    <g style={{ cursor: "grab" }} onPointerDown={(e) => onDown(object, e)}>
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
  strokeUnit,
}: {
  draft: NonNullable<Draft>;
  strokeUnit: number;
}) {
  const { box } = draft;
  const alongX = box.l >= box.w;
  const label =
    draft.kind === "wall" || draft.kind === "door"
      ? `${meters(alongX ? box.l : box.w)} m`
      : `${meters(box.l)} × ${meters(box.w)} m`;
  const center = { x: box.x + box.l / 2, y: box.y + box.w / 2 };

  return (
    <g pointerEvents="none">
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
  strokeUnit,
  onDrag,
}: {
  start: Vec2;
  end: Vec2 | null;
  lineEnd: Vec2 | null;
  strokeUnit: number;
  onDrag: (which: "startPoint" | "endPoint", event: React.PointerEvent) => void;
}) {
  const a = start;
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
            const b = end;
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
  strokeUnit,
}: {
  measure: NonNullable<Measure>;
  strokeUnit: number;
}) {
  const a = measure.from;
  const b = measure.to;
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
 * Flödespil vid en port: åt vilket håll maskinen tar emot eller lämnar paket.
 *
 * Pilen kopplar ingenting. Portarna var förut anslutningspunkter som en
 * solver matchade mot varandra, och positionen räknades fram ur kedjan; nu
 * står maskinerna där kunden ställt dem och pilen är en upplysning om vad
 * maskinen klarar — in på den här sidan, ut på den där.
 *
 * Ingång och utgång ritas åt samma håll som flödet går. Pilspetsen pekar
 * därför in i maskinen på en ingång och bort från den på en utgång, vilket
 * är precis skillnaden man vill se när man vänder en maskin.
 */
function FlowArrow({ port, strokeUnit }: { port: PlacedPort; strokeUnit: number }) {
  const v = DIR_VEC[port.dir];
  const len = strokeUnit * 26;
  const head = strokeUnit * 9;
  const inPort = port.role === "in";
  const color = inPort ? "#5980a6" : "#1d2d3d";

  // Ingången ritas utanför maskinen och pekar in; utgången börjar i porten
  // och pekar ut. Bägge slutar alltså där paketen är på väg.
  const tip = inPort
    ? port.pos
    : { x: port.pos.x + v.x * len, y: port.pos.y + v.y * len };
  const tail = inPort
    ? { x: port.pos.x - v.x * len, y: port.pos.y - v.y * len }
    : port.pos;

  // Vinkelrätt mot flödet, för pilspetsens vingar.
  const n = { x: -v.y, y: v.x };

  return (
    <g pointerEvents="none">
      <line
        x1={tail.x}
        y1={tail.y}
        x2={tip.x}
        y2={tip.y}
        stroke={color}
        strokeWidth={strokeUnit * 2.5}
        strokeLinecap="round"
      />
      <path
        d={
          `M${tip.x} ${tip.y}` +
          `L${tip.x - v.x * head + n.x * head * 0.6} ${tip.y - v.y * head + n.y * head * 0.6}` +
          `L${tip.x - v.x * head - n.x * head * 0.6} ${tip.y - v.y * head - n.y * head * 0.6}Z`
        }
        fill={color}
      />
    </g>
  );
}

/**
 * Vridhandtaget på den markerade maskinen.
 *
 * Vridningen låg bara i inspektorn, som fyra gradknappar längst ut till
 * höger. Man tittade bort från ritningen för att ändra något man ser i den.
 * Handtaget sitter i stället på maskinen: ett klick är ett kvarts varv
 * medurs, skift-klick moturs. Samma sak går med tangenten R.
 *
 * Tecknet är samma som inspektorns, hämtat ur ui.tsx och skalat in i
 * hallens koordinater — inte en egen båge ritad på fri hand. Ringen ligger
 * på vit botten så handtaget syns också över en ritad zon.
 */
function TurnHandle({
  box,
  strokeUnit,
  onTurn,
}: {
  box: Box;
  strokeUnit: number;
  onTurn: (steps: number) => void;
}) {
  const r = strokeUnit * 12;
  // Utanför hörnet, så det aldrig ligger över ytan man drar i.
  const cx = box.x + box.l + r * 1.15;
  const cy = box.y - r * 1.15;
  /*
   * Ikonen är ritad i ett rutnät på 24 med bågens mitt i (12, 12) och en
   * radie på 7. Skalan sätts efter bågen, inte efter rutnätet: annars blir
   * tecknet en liten krumelur mitt i en stor ring.
   */
  const scale = (r * 1.25) / 14;

  return (
    <g
      style={{ cursor: "pointer" }}
      onPointerDown={(e) => {
        // Utan detta börjar ett drag av maskinen under handtaget.
        e.stopPropagation();
        onTurn(e.shiftKey ? -1 : 1);
      }}
    >
      <title>Vrid 90° (skift för andra hållet, eller tangent R)</title>
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="#1d2d3d" strokeWidth={strokeUnit * 1.2} />
      <g
        transform={`translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)`}
        fill="none"
        stroke="#1d2d3d"
        strokeWidth={(strokeUnit * 1.3) / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ROTATE_ARC} />
        <path d={ROTATE_TIP} />
      </g>
    </g>
  );
}
