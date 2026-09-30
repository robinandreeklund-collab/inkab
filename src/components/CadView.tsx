"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { padBox } from "@/lib/projection";
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
import { markerNumber } from "@/lib/flowMarkers";
import { ROTATE_ARC, ROTATE_TIP, TipCard } from "./ui";
import { toolHelp } from "./toolHelp";
import type { Box, DrawnObject, DrawnKind, Flow, Machine, PlacedPort, Placement, Vec2 } from "@/lib/types";
import type { Tool, ViewMode } from "@/store/useConfigStore";
import { DIR_VEC } from "@/lib/geometry";
import { MACHINE_DRAG_TYPE } from "@/lib/dragTypes";
import { useT } from "@/lib/i18n";

/** Rutnätets delning i planvyn, mm. */
const GRID_MM = 1000;
/** Maskiner snappar till detta raster vid drag, mm. */
const SNAP_MM = 250;
const PAD_MM = 4000;

type Draft = { kind: Exclude<Tool, "select" | "measure">; box: Box } | null;

/** Väggens och portens tjocklek, mm. */

type Measure = { from: Vec2; to: Vec2 } | null;

const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;
/** Hallens mått snappar grövre än maskinerna: halvmeter räcker för en lokal. */
const HALL_SNAP_MM = 500;
/** Samma gränser som serverns schema. */
const HALL_LIMITS = { lengthMm: [5000, 300000], widthMm: [5000, 150000] } as const;

/** Förklaring som visas intill muspekaren när man håller den över något i ritningen. */
type Hover = { title: string; body?: string; x: number; y: number } | null;

/** Hallen medan man drar i dess kant. */
type HallDrag = { lengthMm: number; widthMm: number } | null;

type TipHandlers = (
  title: string,
  body?: string,
) => {
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
};

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
    showZones,
    showPorts,
    select,
    moveMachine,
    turnMachine,
    addMachine,
    library,
    draggingMachineId,
    updateDrawn,
    turnDrawn,
    addDrawn,
    setTool,
    setStartPoint,
    updateFlowMarker,
    update,
    guideOpen,
  } = useConfigStore();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const t = useT();
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
  /** Punkten en maskin ur katalogen skulle landa i, medan den dras. */
  const [dropAt, setDropAt] = useState<Vec2 | null>(null);
  const dragged = draggingMachineId
    ? (library.machines.find((m) => m.id === draggingMachineId) ?? null)
    : null;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });
  const [hover, setHover] = useState<Hover>(null);
  const [hallDrag, setHallDrag] = useState<HallDrag>(null);

  /** Hallen som den ser ut just nu — med kanten där musen är, medan man drar i den. */
  const hall = hallDrag ? { ...config.hall, ...hallDrag } : config.hall;
  const hallBox: Box = { x: 0, y: 0, l: hall.lengthMm, w: hall.widthMm };
  /** Det ritade, med portarna i hallens kant följande kanten medan den dras. */
  const drawn = followHallEdges(config.drawn, config.hall, hall);
  const contentBox: Box = useMemo(() => {
    const boxes = [{ x: 0, y: 0, l: config.hall.lengthMm, w: config.hall.widthMm }, layout.bounds];
    for (const d of config.drawn) boxes.push({ x: d.x, y: d.y, l: d.l, w: d.w });
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.l));
    const maxY = Math.max(...boxes.map((b) => b.y + b.w));
    return { x: minX, y: minY, l: maxX - minX, w: maxY - minY };
  }, [config.hall.lengthMm, config.hall.widthMm, layout.bounds, config.drawn]);

  const viewBox = useMemo(() => {
    const framed = frozen ?? contentBox;
    const padded = padBox(framed, PAD_MM);
    // Guiden ligger över ritningens vänstra del. Ge den plats i stället för att
    // låta den täcka startpunkten.
    const guideRoom = guideOpen ? padded.l * 0.3 : 0;
    const base = { ...padded, x: padded.x - guideRoom, l: padded.l + guideRoom };
    const cx = base.x + base.l / 2 + pan.x;
    const cy = base.y + base.w / 2 + pan.y;
    const l = base.l / zoom;
    const w = base.w / zoom;
    return { x: cx - l / 2, y: cy - w / 2, l, w };
  }, [contentBox, frozen, zoom, pan, guideOpen]);

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

  /** Visar en förklaring vid muspekaren. Används av allt i ritningen som har något att säga. */
  const tip: TipHandlers = (title, body) => ({
    onPointerEnter: (e) => setHover({ title, body, x: e.clientX, y: e.clientY }),
    onPointerMove: (e) => setHover({ title, body, x: e.clientX, y: e.clientY }),
    onPointerLeave: () => setHover(null),
  });

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
    setHover(null);
    const hostWalls = doorWalls(walls.filter((w) => w.id !== object.id), config.hall);

    const move = (e: PointerEvent) => {
      const now = at(e);
      const moved = {
        x: snap(from.x + (now.x - start.x)),
        y: snap(from.y + (now.y - start.y)),
      };
      /*
       * En port hör till en vägg. Den glider längs väggen den sitter i och
       * kan hoppa över till en annan vägg eller hallens kant — redan medan
       * man drar, så att avstånden till väggarna som visas stämmer med var
       * den hamnar. Långt från alla väggar blir den en lös ruta som förut.
       */
      if (object.kind === "door") {
        const alongX = object.l >= object.w;
        const centre = {
          x: object.x + object.l / 2 + (now.x - start.x),
          y: object.y + object.w / 2 + (now.y - start.y),
        };
        const width = alongX ? object.l : object.w;
        const guess: Box = alongX
          ? { x: snap(centre.x - width / 2), y: centre.y - 250, l: width, w: 500 }
          : { x: centre.x - 250, y: snap(centre.y - width / 2), l: 500, w: width };
        const fitted = fitDoorToWall(guess, hostWalls, 1500);
        updateDrawn(object.id, fitted ?? { ...moved, l: object.l, w: object.w });
        return;
      }
      updateDrawn(object.id, moved);
    };
    const up = () => {
      setFrozen(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── Dra startpunkten ────────────────────────────────────────────────── */
  const dragStartPoint = (which: "start" | { marker: string }, event: React.PointerEvent) => {
    event.stopPropagation();
    if (tool !== "select") return;
    setHover(null);
    const move = (e: PointerEvent) => {
      const p = toWorld(e);
      if (!p) return;
      const point = { x: snap(p.x), y: snap(p.y) };
      if (which === "start") setStartPoint(point);
      else updateFlowMarker(which.marker, { pos: point });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── Ändra hallens yta ───────────────────────────────────────────────── */
  /*
   * Hallen visas med sin nya kant medan man drar men sparas först när man
   * släpper, så att ett drag blir ett steg att ångra. Utsnittet står still
   * under draget — annars växer ritningen under pekaren och kanten springer
   * ifrån den.
   */
  const startHallResize = (edge: "x" | "y" | "xy", event: React.PointerEvent) => {
    event.stopPropagation();
    if (tool !== "select") return;
    setHover(null);
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return;
    const frozenInverse = ctm.inverse();
    setFrozen(contentBox);
    const clamp = (v: number, [lo, hi]: readonly [number, number]) =>
      Math.min(hi, Math.max(lo, Math.round(v / HALL_SNAP_MM) * HALL_SNAP_MM));
    let latest = { lengthMm: config.hall.lengthMm, widthMm: config.hall.widthMm };

    const move = (e: PointerEvent) => {
      const now = new DOMPoint(e.clientX, e.clientY).matrixTransform(frozenInverse);
      latest = {
        lengthMm: edge === "y" ? config.hall.lengthMm : clamp(now.x, HALL_LIMITS.lengthMm),
        widthMm: edge === "x" ? config.hall.widthMm : clamp(now.y, HALL_LIMITS.widthMm),
      };
      setHallDrag(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setFrozen(null);
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
      // En port visas där den kommer att hamna — i väggen — redan medan man
      // drar, så att avstånden till hörnen stämmer med resultatet.
      const box =
        kind === "door" && raw.l >= 200 && raw.w >= 100
          ? (fitDoorToWall(raw, doorWalls(walls, config.hall)) ?? raw)
          : raw;
      latest = { kind, box };
      setDraft(latest);
    };

    // Lagret ändras här och inte inuti setDraft: en uppdatering av lagret
    // mitt i en annan komponents rendering är något React varnar för.
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      const current = latest as NonNullable<Draft> | null;
      if (current && current.box.l >= 200 && current.box.w >= 100) {
        const box =
          current.kind === "door" ? current.box : finishDraft(current.kind, current.box, walls, config.hall);
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

  const cursor = tool === "select" ? "default" : "crosshair";

  /*
   * Portavstånd: för porten som ritas, dras eller är markerad. Mätt till
   * närmaste vägg på vardera sidan längs väggen den sitter i.
   */
  const doors = drawn.filter((d) => d.kind === "door");
  const measuredId = draft?.kind === "door" ? null : selectedId;
  const measuredDoor: Box | null =
    draft?.kind === "door"
      ? draft.box
      : (() => {
          const door = doors.find((d) => d.id === measuredId);
          return door ? { x: door.x, y: door.y, l: door.l, w: door.w } : null;
        })();
  const clearance = measuredDoor
    ? doorClearance(
        measuredDoor,
        doorWalls(
          drawn.filter((d) => d.kind === "wall"),
          hall,
        ),
        doors.filter((d) => d.id !== measuredId).map((d) => ({ x: d.x, y: d.y, l: d.l, w: d.w })),
      )
    : null;

  /* ── Släpp en maskin ur katalogen ────────────────────────────────────── */
  /*
   * Maskinen läggs där den släpps. Att först klicka fram den på ledig yta
   * och sedan dra den dit den ska är två moment för en sak. Rutan som ritas
   * under pekaren är maskinens verkliga fotavtryck — man ser vad man får
   * innan man släpper.
   */
  const dropMachine = (event: React.DragEvent): Machine | null => {
    const id = event.dataTransfer.getData(MACHINE_DRAG_TYPE);
    return id ? (library.machines.find((m) => m.id === id) ?? null) : null;
  };

  const onDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(MACHINE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const at = toWorld(event.nativeEvent);
    setDropAt(at ? { x: snap(at.x), y: snap(at.y) } : null);
  };

  const onDrop = (event: React.DragEvent) => {
    const machine = dropMachine(event);
    setDropAt(null);
    if (!machine) return;
    event.preventDefault();
    const at = toWorld(event.nativeEvent);
    if (at) addMachine(machine.id, { pos: { x: snap(at.x), y: snap(at.y) } });
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-paper"
      onDragOver={onDragOver}
      onDragLeave={() => setDropAt(null)}
      onDrop={onDrop}
    >
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
            drawn={drawn}
            hall={hall}
            onHallResize={startHallResize}
            tip={tip}
            tool={tool}
            layout={layout}
            onDrawnDown={startDragDrawn}
            onTurnDrawn={turnDrawn}
            turnTitle={t("cad.turn")}
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

        {clearance ? <DoorDimensions clearance={clearance} strokeUnit={strokeUnit} /> : null}

        <FlowMarkers flow={config.flow} strokeUnit={strokeUnit} onDrag={dragStartPoint} tip={tip} />

        {dropAt && dragged ? (
          <g pointerEvents="none">
            <rect
              x={dropAt.x - dragged.footprint.lengthMm / 2}
              y={dropAt.y - dragged.footprint.widthMm / 2}
              width={dragged.footprint.lengthMm}
              height={dragged.footprint.widthMm}
              fill="#5980a6"
              fillOpacity="0.12"
              stroke="#5980a6"
              strokeWidth={strokeUnit * 2}
              strokeDasharray={`${strokeUnit * 6} ${strokeUnit * 4}`}
            />
            <text
              x={dropAt.x}
              y={dropAt.y - dragged.footprint.widthMm / 2 - strokeUnit * 8}
              textAnchor="middle"
              fontSize={strokeUnit * 13}
              fill="#5980a6"
              className="num"
            >
              {dragged.name}
            </text>
          </g>
        ) : null}

        {measure ? <MeasureLine measure={measure} strokeUnit={strokeUnit} /> : null}
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
          <span className="kicker text-accent">{toolHelp(t, tool).title}</span>
          <span>{toolHelp(t, tool).hint}</span>
          <kbd className="num border border-divider px-1 text-[10px] text-muted">Esc</kbd>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between p-2">
        <span className="kicker bg-paper/80 px-1">
          {t("cad.plan")} · {t("cad.snap", { mm: SNAP_MM })}
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
  turnTitle,
  selectedId,
  drawn,
  hall,
  onHallResize,
  tip,
  tool,
}: {
  hallBox: Box;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  drawn: DrawnObject[];
  hall: { lengthMm: number; widthMm: number; clearHeightMm: number };
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
  onTurn: (instanceId: string, steps: number) => void;
  onDrawnDown: (o: DrawnObject, e: React.PointerEvent) => void;
  onTurnDrawn: (id: string) => void;
  turnTitle: string;
  selectedId: string | null;
}) {
  const bounds = layout.bounds;
  const t = useT();
  const handle = strokeUnit * 7;
  const hallTip = tip(t("cad.hallResize.title"), t("cad.hallResize.body"));

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
          tip={tip(d.name, t(`cad.drawn.${d.kind}`))}
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
              title={turnTitle}
            />
          );
        }
        const ritat = config.drawn.find((d) => d.id === selectedId);
        return ritat ? (
          <TurnHandle
            box={{ x: ritat.x, y: ritat.y, l: ritat.l, w: ritat.w }}
            strokeUnit={strokeUnit}
            onTurn={() => onTurnDrawn(ritat.id)}
            title={turnTitle}
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
  tip,
}: {
  object: DrawnObject;
  selected: boolean;
  strokeUnit: number;
  onDown: (o: DrawnObject, e: React.PointerEvent) => void;
  tip: ReturnType<TipHandlers>;
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
    <g style={{ cursor: "grab" }} onPointerDown={(e) => onDown(object, e)} {...tip}>
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

/**
 * Start- och slutpunkter som dragbara markörer i ritningen.
 *
 * Den aktiva startpunkten — där nya maskiner läggs — är fylld. Alternativa
 * starter är ihåliga, och slutpunkterna har ett kryss. Kommentaren, varför
 * punkten ligger där, står under markören och i sin helhet när man håller
 * musen över den. Ingen av dem mäts mot något: med fri placering slutar
 * anläggningen där sista maskinen står, och punkterna är upplysningar till
 * den som läser ritningen.
 */
function FlowMarkers({
  flow,
  strokeUnit,
  onDrag,
  tip,
}: {
  flow: Flow;
  strokeUnit: number;
  onDrag: (which: "start" | { marker: string }, event: React.PointerEvent) => void;
  tip: TipHandlers;
}) {
  const t = useT();
  const r = strokeUnit * 9;

  const marker = (
    key: string,
    role: "start" | "end",
    pos: Vec2,
    label: string,
    comment: string | undefined,
    active: boolean,
    which: "start" | { marker: string },
  ) => {
    const colour = role === "start" ? "#5980a6" : "#1d2d3d";
    const help =
      role === "end" ? t("points.endHelp") : active ? t("points.startHelp") : t("points.altHelp");
    const body = (comment ? `“${comment}”\n\n` : "") + help + " " + t("points.drag");
    return (
      <g
        key={key}
        style={{ cursor: "grab" }}
        onPointerDown={(e) => onDrag(which, e)}
        {...tip(label, body)}
      >
        <circle
          cx={pos.x}
          cy={pos.y}
          r={r}
          fill={active ? colour : "#ffffff"}
          fillOpacity={active ? 0.18 : 0.9}
          stroke={colour}
          strokeWidth={strokeUnit * 1.6}
          strokeDasharray={active || role === "end" ? undefined : `${strokeUnit * 3} ${strokeUnit * 2}`}
        />
        {role === "start" ? (
          <circle cx={pos.x} cy={pos.y} r={strokeUnit * 2.4} fill={colour} />
        ) : (
          <path
            d={`M${pos.x - r} ${pos.y}h${r * 2}M${pos.x} ${pos.y - r}v${r * 2}`}
            stroke={colour}
            strokeWidth={strokeUnit * 1.4}
          />
        )}
        <text
          x={pos.x}
          y={pos.y - r - strokeUnit * 4}
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
            x={pos.x}
            y={pos.y + r + strokeUnit * 13}
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
        marker(
          m.id,
          m.role,
          m.pos,
          `${t(m.role === "start" ? "points.start" : "points.end")} ${markerNumber(flow, m)}`,
          m.comment,
          false,
          { marker: m.id },
        ),
      )}
      {marker("start", "start", flow.startPoint, t("points.start"), flow.startComment, true, "start")}
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
    const at = lineAt - offset;
    const p = (along: number, across: number) => (alongX ? { x: along, y: across } : { x: across, y: along });
    const s = p(a, at);
    const e = p(b, at);
    const label = p((a + b) / 2, at);
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
  title,
}: {
  box: Box;
  strokeUnit: number;
  onTurn: (steps: number) => void;
  title: string;
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
      <title>{title}</title>
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
