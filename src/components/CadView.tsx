"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { isoBounds, isoBox, isoProject, isoUnproject, padBox } from "@/lib/projection";
import { meters } from "@/lib/format";
import {
  closeCorners,
  doorClearance,
  fitDoorToWall,
  followHallEdges,
  hallWalls,
  snapToWalls,
  WALL_THICKNESS_MM,
} from "@/lib/walls";
import { nextName } from "@/lib/drawing";
import { markerLabel, ROLE_HELP } from "@/lib/flowMarkers";
import type { Box, DrawnObject, DrawnKind, Flow, Placement, Vec2 } from "@/lib/types";
import type { Tool, ViewMode } from "@/store/useConfigStore";
import { TipCard } from "./ui";
import { TOOL_HELP } from "./toolHelp";

/** Rutnätets delning i planvyn, mm. */
const GRID_MM = 1000;
/** Maskiner snappar till detta raster vid drag, mm. */
const SNAP_MM = 250;
const PAD_MM = 4000;

type Draft = { kind: Exclude<Tool, "select" | "measure">; box: Box } | null;

/** CadView ritar plan och isometri; läget "model" hanteras av ModelView. */
type PlanarView = Exclude<ViewMode, "model">;

/** Väggens och portens tjocklek, mm. */

type Measure = { from: Vec2; to: Vec2 } | null;

type TipHandlers = (
  title: string,
  body?: string,
) => {
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
};

const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;
/** Hallens mått snappar grövre än maskinerna: halvmeter räcker för en lokal. */
const HALL_SNAP_MM = 500;
/** Samma gränser som serverns schema. */
const HALL_LIMITS = { lengthMm: [5000, 300000], widthMm: [5000, 150000] } as const;

/** Förklaring som visas intill muspekaren när man håller den över något i ritningen. */
type Hover = { title: string; body?: string; x: number; y: number } | null;

/** Ett ritat objekt som dras: visas på sin nya plats men sparas först när man släpper. */
type Moving = { id: string; box: Box } | null;

/** Hallen medan man drar i dess kant. */
type HallDrag = { lengthMm: number; widthMm: number } | null;

/** Väggar en port kan sitta i: de ritade och hallens egna kanter. */
const doorWalls = (walls: DrawnObject[], hall: { lengthMm: number; widthMm: number }) => [
  ...walls,
  ...hallWalls(hall),
];

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
function finishDraft(
  kind: DrawnKind,
  box: Box,
  walls: DrawnObject[],
  hall: { lengthMm: number; widthMm: number },
): Box {
  if (kind === "wall") return closeCorners(box, walls);
  if (kind === "door") return fitDoorToWall(box, doorWalls(walls, hall)) ?? box;
  return box;
}

export function CadView() {
  const {
    config,
    layout,
    view,
    tool,
    selectedId,
    guideOpen,
    showZones,
    showPorts,
    select,
    nudge,
    addDrawn,
    updateDrawn,
    setTool,
    setFlowPoint,
    updateFlowMarker,
    update,
  } = useConfigStore();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const planarView: PlanarView = view === "3d" ? "3d" : "2d";
  const [draft, setDraft] = useState<Draft>(null);
  const [measure, setMeasure] = useState<Measure>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });
  const [hover, setHover] = useState<Hover>(null);
  const [moving, setMoving] = useState<Moving>(null);
  const [hallDrag, setHallDrag] = useState<HallDrag>(null);

  const hall = hallDrag ? { ...config.hall, ...hallDrag } : config.hall;
  const hallBox: Box = { x: 0, y: 0, l: hall.lengthMm, w: hall.widthMm };
  // Vyn räknas på den sparade hallen, inte på den som dras: annars skalar
  // ritningen om under musen och kanten springer ifrån pekaren.
  const contentBox: Box = useMemo(() => {
    const boxes = [{ x: 0, y: 0, l: config.hall.lengthMm, w: config.hall.widthMm }, layout.bounds];
    for (const d of config.drawn) boxes.push({ x: d.x, y: d.y, l: d.l, w: d.w });
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.l));
    const maxY = Math.max(...boxes.map((b) => b.y + b.w));
    return { x: minX, y: minY, l: maxX - minX, w: maxY - minY };
  }, [config.hall.lengthMm, config.hall.widthMm, layout.bounds, config.drawn]);

  const maxHeight = Math.max(config.hall.clearHeightMm, ...layout.placements.map((p) => p.size.heightMm), 1);

  const viewBox = useMemo(() => {
    const padded =
      view === "2d" ? padBox(contentBox, PAD_MM) : padBox(isoBounds(contentBox, maxHeight), PAD_MM);
    // Guiden ligger över ritningens vänstra del. Ge den plats i stället för att
    // låta den täcka startpunkten.
    const guideRoom = guideOpen ? padded.l * 0.3 : 0;
    const base = { ...padded, x: padded.x - guideRoom, l: padded.l + guideRoom };
    const cx = base.x + base.l / 2 + pan.x;
    const cy = base.y + base.w / 2 + pan.y;
    const l = base.l / zoom;
    const w = base.w / zoom;
    return { x: cx - l / 2, y: cy - w / 2, l, w };
  }, [contentBox, view, maxHeight, zoom, pan, guideOpen]);

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

  const strokeUnit = viewBox.l / 900;
  /** Befintliga väggar, som nya väggar och portar fäster mot. */
  const walls = config.drawn.filter((d) => d.kind === "wall");

  /** Det ritade, med objektet som dras på sin tillfälliga plats och portarna i hallens kant följande kanten. */
  const drawn = followHallEdges(
    moving ? config.drawn.map((d) => (d.id === moving.id ? { ...d, ...moving.box } : d)) : config.drawn,
    config.hall,
    hall,
  );

  /** Visar en förklaring vid muspekaren. Används av allt i ritningen som har något att säga. */
  const tip = (title: string, body?: string) => ({
    onPointerEnter: (e: React.PointerEvent) => setHover({ title, body, x: e.clientX, y: e.clientY }),
    onPointerMove: (e: React.PointerEvent) => setHover({ title, body, x: e.clientX, y: e.clientY }),
    onPointerLeave: () => setHover(null),
  });

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
  const dragFlowPoint = (which: "startPoint" | "endPoint" | { marker: string }, event: React.PointerEvent) => {
    event.stopPropagation();
    if (tool !== "select") return;
    setHover(null);
    const move = (e: PointerEvent) => {
      const p = toWorld(e);
      if (!p) return;
      const point = { x: snap(p.x), y: snap(p.y) };
      if (typeof which === "string") setFlowPoint(which, point);
      else updateFlowMarker(which.marker, { pos: point });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── Dra ritade objekt ───────────────────────────────────────────────── */
  /**
   * Väggar och zoner flyttas fritt. En port glider längs väggen den sitter i
   * och kan hoppa över till en annan vägg eller till hallens kant — den blir
   * aldrig en lös ruta på golvet så länge det finns en vägg i närheten.
   * Ändringen sparas när man släpper, så att ett drag blir ett steg att ångra.
   */
  const startMoveDrawn = (object: DrawnObject, event: React.PointerEvent) => {
    event.stopPropagation();
    select(object.id);
    if (tool !== "select") return;
    const start = toWorld(event);
    if (!start) return;
    setHover(null);

    const original: Box = { x: object.x, y: object.y, l: object.l, w: object.w };
    const others = walls.filter((w) => w.id !== object.id);
    let latest: Box | null = null;

    const move = (e: PointerEvent) => {
      const now = toWorld(e);
      if (!now) return;
      const dx = snap(now.x - start.x);
      const dy = snap(now.y - start.y);
      let box: Box = { ...original, x: original.x + dx, y: original.y + dy };
      if (object.kind === "door") {
        // Portens mitt följer musen; väggen bestämmer resten.
        const alongX = original.l >= original.w;
        const width = alongX ? original.l : original.w;
        const centre = { x: original.x + original.l / 2 + (now.x - start.x), y: original.y + original.w / 2 + (now.y - start.y) };
        const guess: Box = alongX
          ? { x: snap(centre.x - width / 2), y: centre.y - 250, l: width, w: 500 }
          : { x: centre.x - 250, y: snap(centre.y - width / 2), l: 500, w: width };
        box = fitDoorToWall(guess, doorWalls(others, config.hall), 1500) ?? box;
      }
      latest = box;
      setMoving({ id: object.id, box });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMoving(null);
      const box = latest as Box | null;
      if (box && (box.x !== original.x || box.y !== original.y || box.l !== original.l || box.w !== original.w)) {
        updateDrawn(object.id, {
          x: Math.round(box.x),
          y: Math.round(box.y),
          l: Math.round(box.l),
          w: Math.round(box.w),
        });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── Ändra hallens yta ───────────────────────────────────────────────── */
  const startHallResize = (edge: "x" | "y" | "xy", event: React.PointerEvent) => {
    event.stopPropagation();
    if (tool !== "select") return;
    setHover(null);
    const clamp = (v: number, [lo, hi]: readonly [number, number]) =>
      Math.min(hi, Math.max(lo, Math.round(v / HALL_SNAP_MM) * HALL_SNAP_MM));
    let latest = { lengthMm: config.hall.lengthMm, widthMm: config.hall.widthMm };

    const move = (e: PointerEvent) => {
      const now = toWorld(e);
      if (!now) return;
      latest = {
        lengthMm: edge === "y" ? config.hall.lengthMm : clamp(now.x, HALL_LIMITS.lengthMm),
        widthMm: edge === "x" ? config.hall.widthMm : clamp(now.y, HALL_LIMITS.widthMm),
      };
      setHallDrag(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setHallDrag(null);
      if (latest.lengthMm !== config.hall.lengthMm || latest.widthMm !== config.hall.widthMm) {
        update((d) => {
          d.drawn = followHallEdges(d.drawn, d.hall, latest);
          d.hall.lengthMm = latest.lengthMm;
          d.hall.widthMm = latest.widthMm;
        });
      }
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
    let latest: NonNullable<Draft> | null = null;
    const move = (e: PointerEvent) => {
      const now = toWorld(e);
      if (!now) return;
      const raw = draftBox(kind, start, now, walls);
      // En port visas där den kommer att hamna — i väggen — redan medan man drar,
      // så att avstånden till hörnen stämmer med resultatet.
      const box =
        kind === "door" && raw.l >= 200 && raw.w >= 100
          ? (fitDoorToWall(raw, doorWalls(walls, config.hall)) ?? raw)
          : raw;
      latest = { kind, box };
      setDraft(latest);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      const current = latest as NonNullable<Draft> | null;
      if (current && current.box.l >= 200 && current.box.w >= 100) {
        const box = current.kind === "door" ? current.box : finishDraft(current.kind, current.box, walls, config.hall);
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

  const cursor = tool === "select" ? "default" : "crosshair";

  /**
   * Portavstånd: för porten som ritas, dras eller är markerad. Mätt till
   * närmaste vägg på vardera sidan längs väggen den sitter i.
   */
  const doors = drawn.filter((d) => d.kind === "door");
  const measuredId = draft?.kind === "door" ? null : (moving?.id ?? selectedId);
  const measuredDoor: Box | null =
    draft?.kind === "door"
      ? draft.box
      : (() => {
          const id = moving?.id ?? selectedId;
          const door = doors.find((d) => d.id === id);
          return door ? { x: door.x, y: door.y, l: door.l, w: door.w } : null;
        })();
  const clearance = measuredDoor
    ? doorClearance(
        measuredDoor,
        doorWalls(
          drawn.filter((d) => d.kind === "wall"),
          hall,
        ),
        doors
          .filter((d) => d.id !== measuredId)
          .map((d) => ({ x: d.x, y: d.y, l: d.l, w: d.w })),
      )
    : null;

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
          fill={view === "2d" ? "url(#grid)" : "#f2f2f3"}
          onPointerDown={startGround}
        />

        {view === "2d" ? (
          <Plan2D
            hallBox={hallBox}
            config={config}
            drawn={drawn}
            hall={hall}
            layout={layout}
            onDrawnDown={startMoveDrawn}
            onHallResize={startHallResize}
            tip={tip}
            tool={tool}
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

        {draft ? <DraftShape draft={draft} view={planarView} strokeUnit={strokeUnit} /> : null}

        {clearance && planarView === "2d" ? (
          <DoorDimensions clearance={clearance} strokeUnit={strokeUnit} />
        ) : null}

        <FlowMarkers
          flow={config.flow}
          view={planarView}
          strokeUnit={strokeUnit}
          onDrag={dragFlowPoint}
          tip={tip}
        />

        {measure ? <MeasureLine measure={measure} view={planarView} strokeUnit={strokeUnit} /> : null}
      </svg>

      {hover ? (
        <TipCard
          rect={{ left: hover.x, right: hover.x, top: hover.y, bottom: hover.y + 12, width: 0, height: 12 }}
          side="bottom"
          title={hover.title}
          body={hover.body}
        />
      ) : null}

      {tool !== "select" ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 border border-accent bg-white px-3 py-1.5 text-xs shadow-sm">
          <span className="kicker text-accent">{TOOL_HELP[tool].title}</span>
          <span>{TOOL_HELP[tool].hint}</span>
          <kbd className="num border border-divider px-1 text-[10px] text-muted">Esc</kbd>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between p-2">
        <span className="kicker bg-paper/80 px-1">
          {view === "2d" ? "Planvy" : "Isometrisk vy"} · snapp {SNAP_MM} mm
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
  drawn,
  hall,
  layout,
  showZones,
  showPorts,
  strokeUnit,
  fillFor,
  strokeFor,
  labelFor,
  onMachineDown,
  onDrawnDown,
  onHallResize,
  tip,
  tool,
  selectedId,
}: {
  hallBox: Box;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  drawn: DrawnObject[];
  hall: { lengthMm: number; widthMm: number; clearHeightMm: number };
  onDrawnDown: (object: DrawnObject, e: React.PointerEvent) => void;
  onHallResize: (edge: "x" | "y" | "xy", e: React.PointerEvent) => void;
  tip: TipHandlers;
  tool: Tool;
  layout: ReturnType<typeof useConfigStore.getState>["layout"];
  showZones: boolean;
  showPorts: boolean;
  strokeUnit: number;
  fillFor: (p: Placement) => string;
  strokeFor: (p: Placement) => string;
  labelFor: (p: Placement) => string;
  onMachineDown: (p: Placement, e: React.PointerEvent) => void;
  selectedId: string | null;
}) {
  const bounds = layout.bounds;
  const handle = strokeUnit * 7;
  const hallTip = tip(
    "Ändra hallens yta",
    "Dra i kanten eller hörnet. Måttet visas medan du drar, och allt kan också skrivas in exakt under Hall och zoner.",
  );

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
        HALL {meters(hall.lengthMm)} × {meters(hall.widthMm)} m · fri höjd{" "}
        {meters(hall.clearHeightMm)} m
      </text>

      {/* Hallens kanter: dra för att ändra ytan direkt i ritningen. Under det
          ritade, så att en port i kanten går att ta tag i. */}
      {tool === "select" ? (
        <g>
          <rect
            x={hallBox.l - handle}
            y={0}
            width={handle * 2}
            height={hallBox.w}
            fill="transparent"
            style={{ cursor: "ew-resize" }}
            onPointerDown={(e) => onHallResize("x", e)}
            {...hallTip}
          />
          <rect
            x={0}
            y={hallBox.w - handle}
            width={hallBox.l}
            height={handle * 2}
            fill="transparent"
            style={{ cursor: "ns-resize" }}
            onPointerDown={(e) => onHallResize("y", e)}
            {...hallTip}
          />
          {(
            [
              ["x", hallBox.l, hallBox.w / 2, "ew-resize"],
              ["y", hallBox.l / 2, hallBox.w, "ns-resize"],
              ["xy", hallBox.l, hallBox.w, "nwse-resize"],
            ] as const
          ).map(([edge, x, y, cursor]) => (
            <rect
              key={edge}
              x={x - handle}
              y={y - handle}
              width={handle * 2}
              height={handle * 2}
              fill="#ffffff"
              stroke="#5980a6"
              strokeWidth={strokeUnit * 1.6}
              style={{ cursor }}
              onPointerDown={(e) => onHallResize(edge, e)}
              {...hallTip}
            />
          ))}
          <text
            x={hallBox.l / 2}
            y={hallBox.w + handle + strokeUnit * 16}
            textAnchor="middle"
            fontSize={strokeUnit * 13}
            fill="#5980a6"
            className="num"
            pointerEvents="none"
          >
            {meters(hall.lengthMm)} m
          </text>
          <text
            x={hallBox.l + handle + strokeUnit * 6}
            y={hallBox.w / 2 + strokeUnit * 22}
            fontSize={strokeUnit * 13}
            fill="#5980a6"
            className="num"
            pointerEvents="none"
          >
            {meters(hall.widthMm)} m
          </text>
        </g>
      ) : null}

      {drawn.map((d) => (
        <DrawnShape
          key={d.id}
          object={d}
          selected={d.id === selectedId}
          strokeUnit={strokeUnit}
          onDown={onDrawnDown}
          tip={tip}
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
          <g key={p.instanceId} onPointerDown={(e) => onMachineDown(p, e)} style={{ cursor: "grab" }}>
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
const DRAWN_TIP: Record<DrawnKind, string> = {
  wall: "Dra för att flytta. Markera för att ändra längd, höjd eller ta bort.",
  door: "Dra längs väggen för att flytta porten — avståndet till väggarna på båda sidor visas medan du drar.",
  truck: "Truckens yta. Maskiner hålls borta härifrån. Dra för att flytta.",
  nogo: "Här får inget stå. Regelverket varnar om en maskin hamnar här. Dra för att flytta.",
};

function DrawnShape({
  object,
  selected,
  strokeUnit,
  onDown,
  tip,
}: {
  object: DrawnObject;
  selected: boolean;
  strokeUnit: number;
  onDown: (object: DrawnObject, e: React.PointerEvent) => void;
  tip: TipHandlers;
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
      style={{ cursor: "move" }}
      onPointerDown={(e) => onDown(object, e)}
      {...tip(object.name, DRAWN_TIP[object.kind])}
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

/**
 * Start- och slutpunkter som dragbara markörer i ritningen. Den aktiva
 * punkten är fylld; alternativen är ihåliga och numrerade. Kommentaren — varför
 * punkten ligger där — visas när man håller musen över den.
 */
function FlowMarkers({
  flow,
  view,
  strokeUnit,
  onDrag,
  tip,
}: {
  flow: Flow;
  view: PlanarView;
  strokeUnit: number;
  onDrag: (which: "startPoint" | "endPoint" | { marker: string }, event: React.PointerEvent) => void;
  tip: TipHandlers;
}) {
  const project = (v: Vec2) => (view === "2d" ? v : isoProject(v.x, v.y, 0));
  const r = strokeUnit * 9;

  const marker = (
    key: string,
    role: "start" | "end",
    pos: Vec2,
    label: string,
    comment: string | undefined,
    active: boolean,
    which: "startPoint" | "endPoint" | { marker: string },
  ) => {
    const p = project(pos);
    const colour = role === "start" ? "#5980a6" : "#1d2d3d";
    const body =
      (comment ? `“${comment}”\n\n` : "") +
      (active ? ROLE_HELP[role] : "Alternativ punkt. Gör den aktiv i sidopanelen för att bygga linjen härifrån.") +
      " Dra för att flytta.";
    return (
      <g
        key={key}
        style={{ cursor: "grab" }}
        onPointerDown={(e) => onDrag(which, e)}
        {...tip(comment ? `${label} · ${comment}` : label, body)}
      >
        <circle
          cx={p.x}
          cy={p.y}
          r={r}
          fill={active ? colour : "#ffffff"}
          fillOpacity={active ? 0.18 : 0.9}
          stroke={colour}
          strokeWidth={strokeUnit * 1.6}
          strokeDasharray={active ? undefined : `${strokeUnit * 3} ${strokeUnit * 2}`}
        />
        {role === "start" ? (
          <circle cx={p.x} cy={p.y} r={strokeUnit * 2.4} fill={colour} />
        ) : (
          <path d={`M${p.x - r} ${p.y}h${r * 2}M${p.x} ${p.y - r}v${r * 2}`} stroke={colour} strokeWidth={strokeUnit * 1.4} />
        )}
        <text
          x={p.x}
          y={p.y - r - strokeUnit * 4}
          textAnchor="middle"
          fontSize={strokeUnit * 12}
          fill={colour}
          className="num"
          pointerEvents="none"
        >
          {label.toUpperCase()}
        </text>
        {comment ? (
          <text
            x={p.x}
            y={p.y + r + strokeUnit * 13}
            textAnchor="middle"
            fontSize={strokeUnit * 10}
            fill={colour}
            fillOpacity="0.8"
            pointerEvents="none"
          >
            {comment.length > 28 ? `${comment.slice(0, 27)}…` : comment}
          </text>
        ) : null}
      </g>
    );
  };

  return (
    <g>
      {(flow.markers ?? []).map((m) =>
        marker(m.id, m.role, m.pos, markerLabel(flow, m), m.comment, false, { marker: m.id }),
      )}
      {marker("start", "start", flow.startPoint, "Start", flow.startComment, true, "startPoint")}
      {flow.endPoint ? marker("end", "end", flow.endPoint, "Slut", flow.endComment, true, "endPoint") : null}
    </g>
  );
}

/**
 * Portens fria mått till närmaste vägg åt båda håll, utritat som måttlinjer
 * längs väggen. Uppdateras medan porten ritas eller dras.
 */
function DoorDimensions({
  clearance,
  strokeUnit,
}: {
  clearance: NonNullable<ReturnType<typeof doorClearance>>;
  strokeUnit: number;
}) {
  const { alongX, lineAt, from, to, before, after } = clearance;
  const offset = WALL_THICKNESS_MM + strokeUnit * 22;
  const tick = strokeUnit * 6;

  const dimension = (a: number, b: number, value: number, key: string) => {
    if (value <= 0) return null;
    const mid = (a + b) / 2;
    const at = lineAt - offset;
    const p = (along: number, across: number) => (alongX ? { x: along, y: across } : { x: across, y: along });
    const s = p(a, at);
    const e = p(b, at);
    const label = p(mid, at);
    const w = strokeUnit * 46;
    const h = strokeUnit * 18;
    return (
      <g key={key}>
        <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="#5980a6" strokeWidth={strokeUnit * 1.2} />
        {[s, e].map((q, i) => (
          <line
            key={i}
            x1={alongX ? q.x : q.x - tick}
            y1={alongX ? q.y - tick : q.y}
            x2={alongX ? q.x : q.x + tick}
            y2={alongX ? q.y + tick : q.y}
            stroke="#5980a6"
            strokeWidth={strokeUnit * 1.2}
          />
        ))}
        <rect x={label.x - w / 2} y={label.y - h / 2} width={w} height={h} fill="#5980a6" />
        <text
          x={label.x}
          y={label.y + strokeUnit * 4.5}
          textAnchor="middle"
          fontSize={strokeUnit * 12}
          fill="#ffffff"
          className="num"
        >
          {meters(value, 2)} m
        </text>
      </g>
    );
  };

  return (
    <g pointerEvents="none">
      {dimension(from - before, from, before, "before")}
      {dimension(to, to + after, after, "after")}
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
