import { getMachine } from "./library";
import {
  DIR_VEC,
  ROTATIONS,
  boxToWorld,
  boxesOverlap,
  rightOf,
  rotatePoint,
  toWorld,
  transformDir,
  unionBox,
} from "./geometry";
import type {
  Aisle,
  Box,
  Configuration,
  Dir,
  LayoutResult,
  LineItem,
  Machine,
  Metrics,
  Placement,
  PlacedPort,
  Rotation,
  Side,
  Vec2,
} from "./types";

/** Maskiner räknas som överlappande först över denna gräns, mm. */
const TOUCH_EPSILON_MM = 30;
/** Fritt utrymme mellan maskin och hjälpobjekt, mm. */
export const AUX_GAP_MM = 1500;
/** Fritt utrymme mellan linjen och truckgatan, mm. */
export const AISLE_GAP_MM = 1200;
/** Truckgatans bredd, mm. */
export const TRUCK_AISLE_MM = 5000;
/** Marginal från hallens vägg till linjens start, mm. */
export const HALL_INSET_MM = 2000;
/** Hjälpobjekt får nudda varandra men inte överlappa, mm. */
const AUX_COLLISION_TOLERANCE_MM = 100;
/** Hur långt ett hjälpobjekt får glida i sidled för att hitta fri plats. */
const AUX_MAX_SLIDE_STEPS = 12;
/** Fritt utrymme som hålls mellan maskiner efter en riktningsändring, mm. */
const TURN_CLEARANCE_MM = 400;
/** Antal försök att skjuta fram markören förbi redan placerade maskiner. */
const MAX_CLEARANCE_ATTEMPTS = 8;

export type EffectiveMachine = Machine & {
  effLengthMm: number;
  effWidthMm: number;
  effHeightMm: number;
  effCapacity: number;
  effPowerKw: number;
};

/**
 * Räknar ut maskinens verkliga mått efter valda optioner och, för sista
 * kedjetransportören, efter den längd kunden angett.
 */
export function effectiveMachine(
  machine: Machine,
  selectedOptions: string[],
  overrideLengthMm?: number,
): EffectiveMachine {
  let lengthMm = machine.footprint.lengthMm;
  let widthMm = machine.footprint.widthMm;
  let capacity = machine.capacity.packagesPerHour;
  let powerKw = machine.utilities.powerKw;

  for (const optId of selectedOptions) {
    const opt = machine.options.find((o) => o.id === optId);
    if (!opt) continue;
    lengthMm += opt.deltaLengthMm ?? 0;
    widthMm += opt.deltaWidthMm ?? 0;
    capacity += opt.deltaCapacity ?? 0;
    powerKw += opt.deltaPowerKw ?? 0;
  }

  if (machine.parametricLength && overrideLengthMm != null) {
    lengthMm = Math.min(
      machine.parametricLength.maxMm,
      Math.max(machine.parametricLength.minMm, Math.round(overrideLengthMm)),
    );
  }

  return {
    ...machine,
    effLengthMm: lengthMm,
    effWidthMm: widthMm,
    effHeightMm: machine.footprint.heightMm,
    effCapacity: Math.max(0, capacity),
    effPowerKw: Math.max(0, powerKw),
  };
}

/** Portar skalade till maskinens verkliga mått. */
function scaledPorts(m: EffectiveMachine) {
  const lr = m.effLengthMm / m.footprint.lengthMm;
  const wr = m.effWidthMm / m.footprint.widthMm;
  return m.ports.map((p) => ({ ...p, pos: { x: p.pos.x * lr, y: p.pos.y * wr } }));
}

/** Zoner skalade i längdled; tvärgående fri­mått hålls konstanta. */
function scaledZones(m: EffectiveMachine) {
  const lr = m.effLengthMm / m.footprint.lengthMm;
  const widthDelta = m.effWidthMm - m.footprint.widthMm;
  return m.zones.map((z) => {
    const spansWidth = z.box.y <= 0 && z.box.y + z.box.w >= m.footprint.widthMm;
    return {
      type: z.type,
      label: z.label,
      box: {
        x: z.box.x * lr,
        y: z.box.y,
        l: z.box.l * lr,
        w: spansWidth ? z.box.w + widthDelta : z.box.w,
      } as Box,
    };
  });
}

type Cursor = { point: Vec2; dir: Dir };

function startCursor(config: Configuration): Cursor {
  const midY = Math.round(config.hall.widthMm / 2);
  switch (config.flow.infeedFrom) {
    case "right":
      // Paketen kommer in från högersidan (+Y) och färdas alltså mot −Y.
      return { point: { x: HALL_INSET_MM, y: config.hall.widthMm - HALL_INSET_MM }, dir: "y-" };
    case "left":
      return { point: { x: HALL_INSET_MM, y: HALL_INSET_MM }, dir: "y+" };
    default:
      return { point: { x: HALL_INSET_MM, y: midY }, dir: "x+" };
  }
}

/** Hur bra en resulterande flödesriktning är; huvudlinjen ska gå längs hallen. */
function dirScore(d: Dir): number {
  if (d === "x+") return 2;
  if (d === "x-") return 0;
  return 1;
}

type FitCandidate = { rotation: Rotation; mirrored: boolean; outDir: Dir; score: number };

/** Väljer rotation och speglingsläge så att inporten möter flödet. */
function fitMachine(
  m: EffectiveMachine,
  cursor: Cursor,
  preferMirrored: boolean,
): { rotation: Rotation; mirrored: boolean } | null {
  const ports = scaledPorts(m);
  const inPort = ports.find((p) => p.role === "in");
  const outPort = ports.find((p) => p.role === "out");
  if (!inPort || !outPort) return null;

  const mirrorStates = m.mirrorable ? [preferMirrored, !preferMirrored] : [false];
  const candidates: FitCandidate[] = [];

  for (const mirrored of mirrorStates) {
    for (const rotation of ROTATIONS) {
      if (transformDir(inPort.dir, { rotation, mirrored }) !== cursor.dir) continue;
      const outDir = transformDir(outPort.dir, { rotation, mirrored });
      // Föredra det speglingsläge kunden valt när båda ger samma flödesriktning.
      const preferenceBonus = mirrored === preferMirrored ? 0.5 : 0;
      candidates.push({ rotation, mirrored, outDir, score: dirScore(outDir) + preferenceBonus });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { rotation: candidates[0].rotation, mirrored: candidates[0].mirrored };
}


/**
 * Hur långt markören måste flyttas längs `dir` för att `box` ska gå fri från
 * redan placerade maskiner. Behövs framför allt efter en riktningsändring, då
 * kedjan annars kan svänga rakt in i maskinen den nyss lämnade.
 */
function clearanceShift(box: Box, others: Box[], dir: Dir, clearance: number): number {
  const blocking = others.filter((o) => boxesOverlap(box, o, TOUCH_EPSILON_MM));
  if (blocking.length === 0) return 0;

  switch (dir) {
    case "x+":
      return Math.max(...blocking.map((o) => o.x + o.l + clearance - box.x));
    case "x-":
      return Math.max(...blocking.map((o) => box.x + box.l + clearance - o.x));
    case "y+":
      return Math.max(...blocking.map((o) => o.y + o.w + clearance - box.y));
    case "y-":
      return Math.max(...blocking.map((o) => box.y + box.w + clearance - o.y));
  }
}

function placeOne(
  item: LineItem,
  m: EffectiveMachine,
  pos: number,
  cursor: Cursor,
  preferMirrored: boolean,
): { placement: Placement; idealBbox: Box; next: Cursor } | null {
  const fit = fitMachine(m, cursor, preferMirrored);
  if (!fit) return null;

  const ports = scaledPorts(m);
  const inPort = ports.find((p) => p.role === "in")!;
  const outPort = ports.find((p) => p.role === "out")!;
  const opts = { rotation: fit.rotation, mirrored: fit.mirrored, widthMm: m.effWidthMm };

  // origo väljs så att inporten hamnar exakt på markörens punkt
  const inOffset = rotatePoint(
    fit.mirrored ? { x: inPort.pos.x, y: m.effWidthMm - inPort.pos.y } : inPort.pos,
    fit.rotation,
  );
  const origin: Vec2 = {
    x: Math.round(cursor.point.x - inOffset.x),
    y: Math.round(cursor.point.y - inOffset.y),
  };

  const manual = item.manualOffset ?? { x: 0, y: 0 };
  const placedOrigin: Vec2 = { x: origin.x + manual.x, y: origin.y + manual.y };
  const full = { ...opts, origin: placedOrigin };

  const bbox = boxToWorld({ x: 0, y: 0, l: m.effLengthMm, w: m.effWidthMm }, full);

  const placedPorts: PlacedPort[] = ports.map((p) => ({
    id: p.id,
    role: p.role,
    pos: toWorld(p.pos, full),
    dir: transformDir(p.dir, opts),
    levelMm: p.levelMm,
  }));

  const placement: Placement = {
    instanceId: item.instanceId,
    machineId: m.id,
    machine: m,
    pos,
    aux: false,
    origin: placedOrigin,
    rotation: fit.rotation,
    mirrored: fit.mirrored,
    size: { lengthMm: m.effLengthMm, widthMm: m.effWidthMm, heightMm: m.effHeightMm },
    bbox,
    ports: placedPorts,
    zones: scaledZones(m).map((z) => ({ type: z.type, label: z.label, box: boxToWorld(z.box, full) })),
    capacity: m.effCapacity,
    powerKw: m.effPowerKw,
  };

  // Markören förs vidare från den ideala (ojusterade) utporten så att en manuell
  // förskjutning av en maskin inte river hela resten av kedjan.
  const outOffset = rotatePoint(
    fit.mirrored ? { x: outPort.pos.x, y: m.effWidthMm - outPort.pos.y } : outPort.pos,
    fit.rotation,
  );
  const next: Cursor = {
    point: { x: Math.round(origin.x + outOffset.x), y: Math.round(origin.y + outOffset.y) },
    dir: transformDir(outPort.dir, opts),
  };

  // Idealboxen är placeringen utan manuell förskjutning. Kedjan och frigången
  // räknas alltid på den, så att en flyttad maskin inte drar med sig resten.
  const idealBbox = boxToWorld(
    { x: 0, y: 0, l: m.effLengthMm, w: m.effWidthMm },
    { ...opts, origin },
  );

  return { placement, idealBbox, next };
}

/**
 * Placerar ett hjälpobjekt bredvid sin ankarmaskin på vald sida. Om platsen är
 * upptagen glider objektet i sidled längs linjen tills det står fritt — samma
 * sida och samma avstånd behålls, bara läget längs linjen justeras.
 */
function placeAux(
  item: LineItem,
  m: EffectiveMachine,
  anchor: Placement | null,
  anchorDir: Dir,
  side: Side,
  fallback: Vec2,
  occupied: Placement[],
): Placement {
  const l = m.effLengthMm;
  const w = m.effWidthMm;
  let origin: Vec2 = { ...fallback };
  let slideAxis: "x" | "y" = "x";

  if (anchor) {
    const r = rightOf(anchorDir);
    const s: Vec2 = side === "right" ? r : { x: -r.x, y: -r.y };
    const a = anchor.bbox;
    const cx = a.x + a.l / 2;
    const cy = a.y + a.w / 2;

    if (s.y !== 0) {
      slideAxis = "x";
      origin = {
        x: Math.round(cx - l / 2),
        y: Math.round(s.y > 0 ? a.y + a.w + AUX_GAP_MM : a.y - AUX_GAP_MM - w),
      };
    } else {
      slideAxis = "y";
      origin = {
        x: Math.round(s.x > 0 ? a.x + a.l + AUX_GAP_MM : a.x - AUX_GAP_MM - l),
        y: Math.round(cy - w / 2),
      };
    }
  }

  const manual = item.manualOffset ?? { x: 0, y: 0 };
  const manuallyMoved = manual.x !== 0 || manual.y !== 0;

  // Undvik krock med redan placerade objekt genom att glida längs linjen.
  if (!manuallyMoved && occupied.length > 0) {
    const extent = slideAxis === "x" ? l : w;
    const step = extent + AUX_GAP_MM;
    const free = (candidate: Vec2) => {
      const box: Box = { x: candidate.x, y: candidate.y, l, w };
      return !occupied.some((p) => boxesOverlap(box, p.bbox, AUX_COLLISION_TOLERANCE_MM));
    };
    if (!free(origin)) {
      const base = { ...origin };
      for (let i = 1; i <= AUX_MAX_SLIDE_STEPS; i++) {
        const offsets = [i * step, -i * step];
        const found = offsets
          .map((d) => (slideAxis === "x" ? { x: base.x + d, y: base.y } : { x: base.x, y: base.y + d }))
          .find(free);
        if (found) {
          origin = found;
          break;
        }
      }
    }
  }

  origin = { x: origin.x + manual.x, y: origin.y + manual.y };
  const full = { origin, rotation: 0 as Rotation, mirrored: false, widthMm: w };
  const bbox: Box = { x: origin.x, y: origin.y, l, w };

  return {
    instanceId: item.instanceId,
    machineId: m.id,
    machine: m,
    pos: 0,
    aux: true,
    origin,
    rotation: 0,
    mirrored: false,
    size: { lengthMm: l, widthMm: w, heightMm: m.effHeightMm },
    bbox,
    ports: [],
    zones: scaledZones(m).map((z) => ({ type: z.type, label: z.label, box: boxToWorld(z.box, full) })),
    capacity: 0,
    powerKw: m.effPowerKw,
  };
}

function buildAisle(lineBounds: Box, outDir: Dir, side: Side): Aisle {
  const r = rightOf(outDir);
  const s: Vec2 = side === "right" ? r : { x: -r.x, y: -r.y };

  if (s.y !== 0) {
    const y =
      s.y > 0
        ? lineBounds.y + lineBounds.w + AISLE_GAP_MM
        : lineBounds.y - AISLE_GAP_MM - TRUCK_AISLE_MM;
    return {
      box: { x: lineBounds.x, y: Math.round(y), l: lineBounds.l, w: TRUCK_AISLE_MM },
      label: `Truckgata ${(TRUCK_AISLE_MM / 1000).toFixed(1).replace(".", ",")} m`,
      side,
      widthMm: TRUCK_AISLE_MM,
    };
  }

  const x =
    s.x > 0 ? lineBounds.x + lineBounds.l + AISLE_GAP_MM : lineBounds.x - AISLE_GAP_MM - TRUCK_AISLE_MM;
  return {
    box: { x: Math.round(x), y: lineBounds.y, l: TRUCK_AISLE_MM, w: lineBounds.w },
    label: `Truckgata ${(TRUCK_AISLE_MM / 1000).toFixed(1).replace(".", ",")} m`,
    side,
    widthMm: TRUCK_AISLE_MM,
  };
}

function computeMetrics(placements: Placement[], aisle: Aisle | null, bounds: Box): Metrics {
  const line = placements.filter((p) => !p.aux);
  const withCapacity = line.filter((p) => p.capacity > 0);
  const bottleneckPlacement = withCapacity.reduce<Placement | null>(
    (min, p) => (min === null || p.capacity < min.capacity ? p : min),
    null,
  );

  const area = aisle
    ? unionBox([bounds, aisle.box])
    : bounds;

  return {
    totalLengthMm: Math.round(bounds.l),
    totalWidthMm: Math.round(bounds.w),
    maxHeightMm: Math.max(0, ...placements.map((p) => p.size.heightMm)),
    footprintM2: Math.round((area.l / 1000) * (area.w / 1000)),
    throughputPerHour: withCapacity.length ? Math.min(...withCapacity.map((p) => p.capacity)) : 0,
    bottleneck: bottleneckPlacement
      ? {
          instanceId: bottleneckPlacement.instanceId,
          name: bottleneckPlacement.machine.name,
          capacity: bottleneckPlacement.capacity,
        }
      : null,
    totalPowerKw: Math.round(placements.reduce((a, p) => a + p.powerKw, 0) * 10) / 10,
    totalAirNlPerMin: placements.reduce((a, p) => a + p.machine.utilities.airNlPerMin, 0),
    pitCount: placements.filter((p) => p.machine.foundation.pitDepthMm > 0).length,
    leadTimeWeeks: Math.max(0, ...placements.map((p) => p.machine.leadTimeWeeks)),
  };
}

export type SolveOutput = Omit<LayoutResult, "diagnostics"> & {
  /** Maskiner som inte gick att koppla in i kedjan. */
  unplaced: { instanceId: string; machineId: string; reason: string }[];
  /** Flödesriktning ut ur sista maskinen. */
  outDir: Dir;
  /** Sant om kedjan aldrig vändes tillbaka till hallens längdriktning. */
  neverTurnedToMainAxis: boolean;
};

/**
 * Deterministisk layoutgenerering. Samma konfiguration ger alltid samma
 * geometri — inga slumpmässiga eller modellgenererade placeringar.
 */
export function solveLayout(config: Configuration): SolveOutput {
  const preferMirrored = config.flow.controlDeskSide === "left";
  const placements: Placement[] = [];
  const unplaced: SolveOutput["unplaced"] = [];

  const resolved = config.line
    .map((item) => ({ item, machine: getMachine(item.machineId) }))
    .filter((r): r is { item: LineItem; machine: Machine } => !!r.machine);

  const lineItems = resolved.filter((r) => !r.machine.aux);
  const auxItems = resolved.filter((r) => r.machine.aux);

  // Sista transportmaskinen med parametrisk längd styrs av flödesfrågan.
  const parametricIndex = (() => {
    for (let i = lineItems.length - 1; i >= 0; i--) {
      if (lineItems[i].machine.parametricLength) return i;
    }
    return -1;
  })();

  let cursor = startCursor(config);
  const idealBoxes: Box[] = [];
  const startDir = cursor.dir;
  let turnedToMainAxis = startDir === "x+";

  lineItems.forEach(({ item, machine }, index) => {
    const eff = effectiveMachine(
      machine,
      item.selectedOptions,
      index === parametricIndex ? config.flow.finalConveyorLengthMm : undefined,
    );

    let result = placeOne(item, eff, index + 1, cursor, preferMirrored);
    if (!result) {
      unplaced.push({
        instanceId: item.instanceId,
        machineId: machine.id,
        reason: "Ingen port matchar det inkommande flödet.",
      });
      return;
    }

    // Skjut fram markören tills maskinen står fri från de tidigare.
    for (let attempt = 0; attempt < MAX_CLEARANCE_ATTEMPTS; attempt++) {
      const shift = clearanceShift(result.idealBbox, idealBoxes, cursor.dir, TURN_CLEARANCE_MM);
      if (shift <= 0) break;
      const v = DIR_VEC[cursor.dir];
      cursor = {
        dir: cursor.dir,
        point: {
          x: Math.round(cursor.point.x + v.x * shift),
          y: Math.round(cursor.point.y + v.y * shift),
        },
      };
      const retry = placeOne(item, eff, index + 1, cursor, preferMirrored);
      if (!retry) break;
      result = retry;
    }

    placements.push(result.placement);
    idealBoxes.push(result.idealBbox);
    cursor = result.next;
    if (cursor.dir === "x+") turnedToMainAxis = true;
  });

  const linePlacements = placements.filter((p) => !p.aux);
  const lineBounds = unionBox(linePlacements.map((p) => p.bbox));

  // Hjälpobjekt placeras relativt sin ankarmaskin.
  for (const { item, machine } of auxItems) {
    const eff = effectiveMachine(machine, item.selectedOptions);
    let anchor: Placement | null = null;

    if (machine.anchorFor) {
      anchor = linePlacements.find((p) => p.machineId === machine.anchorFor) ?? null;
    }
    if (!anchor && machine.category === "control") {
      anchor = linePlacements.reduce<Placement | null>(
        (best, p) =>
          best === null || (p.machine.operatorPriority ?? 0) > (best.machine.operatorPriority ?? 0)
            ? p
            : best,
        null,
      );
    }
    anchor = anchor ?? linePlacements[linePlacements.length - 1] ?? null;

    const anchorDir =
      anchor?.ports.find((p) => p.role === "out")?.dir ?? (cursor.dir as Dir);
    const side: Side =
      machine.category === "control" ? config.flow.controlDeskSide : config.flow.stickerMagazineSide;

    placements.push(
      placeAux(
        item,
        eff,
        anchor,
        anchorDir,
        side,
        { x: lineBounds.x, y: lineBounds.y + lineBounds.w + AUX_GAP_MM },
        placements,
      ),
    );
  }

  const bounds = unionBox(placements.map((p) => p.bbox));
  const outDir = cursor.dir;
  const aisle = linePlacements.length
    ? buildAisle(lineBounds, outDir, config.flow.truckPickupSide)
    : null;

  return {
    placements,
    aisle,
    bounds,
    metrics: computeMetrics(placements, aisle, bounds),
    unplaced,
    outDir,
    neverTurnedToMainAxis: !turnedToMainAxis,
  };
}

export { DIR_VEC };
