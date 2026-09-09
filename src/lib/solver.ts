import { BUILTIN_LIBRARY, getMachine, type MachineLibrary } from "./library";
import {
  DIR_VEC,
  ROTATIONS,
  boxToWorld,
  boxesOverlap,
  rightOf,
  rotatePoint,
  scaleZones,
  toWorld,
  transformDir,
  unionBox,
} from "./geometry";
import type {
  Aisle,
  Box,
  Zone,
  Configuration,
  Dir,
  ParameterValue,
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
/** Förslagen bredd på en truckgata, mm. Kunden ändrar den fritt. */
export const TRUCK_AISLE_MM = 5000;
/** Förslagen längd på en hämtzon vid utlastningen, mm. */
export const TRUCK_PICKUP_LENGTH_MM = 9000;
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
 * Löser upp valt utförande till en maskin.
 *
 * Ett utförande är samma konstruktion i ett annat mått — en rullbana på 3, 6
 * eller 12 meter. Det byter fotavtryck, modell och eventuellt portar och
 * kapacitet; allt annat är maskinens. Genom att göra det HÄR, före optioner
 * och parametrar, behöver ingenting nedströms känna till varianter alls:
 * solvern, reglerna och 3D-vyn ser bara en maskin med sina mått.
 *
 * Utan valt utförande används det första, om maskinen har några. En maskin
 * med utföranden har inget eget "grundmått" som är rimligt att rita.
 */
export function resolveVariant(machine: Machine, variantId?: string): Machine {
  const variants = machine.variants ?? [];
  if (variants.length === 0) return machine;

  const variant = variants.find((v) => v.id === variantId) ?? variants[0];

  /*
   * Utan egna portlägen ärver utförandet maskinens, skalade till sitt mått.
   * Utan skalningen skulle en tolvmetersbana ha sin utport där sexmetersbanan
   * slutar — mitt på maskinen — och kedjan skulle byggas ihop på fel ställe.
   * Att kräva egna portar per utförande vore att be om samma uppgift tre
   * gånger för samma konstruktion.
   */
  const lr = variant.footprint.lengthMm / machine.footprint.lengthMm;
  const wr = variant.footprint.widthMm / machine.footprint.widthMm;
  const ports =
    variant.ports ??
    machine.ports.map((port) => ({
      ...port,
      pos: { x: Math.round(port.pos.x * lr), y: Math.round(port.pos.y * wr) },
    }));

  return {
    ...machine,
    footprint: variant.footprint,
    ports,
    // Zonerna hör till maskinen, inte till måttet: en servicezon längs en
    // sexmetersbana ska vara tolv meter lång på tolvmetersvarianten.
    zones: scaleZones(machine.zones, machine.footprint, variant.footprint),
    model: variant.model ?? machine.model,
    capacity: {
      ...machine.capacity,
      packagesPerHour: variant.packagesPerHour ?? machine.capacity.packagesPerHour,
    },
    dimensionsVerified: variant.dimensionsVerified ?? machine.dimensionsVerified,
  };
}

/**
 * Räknar ut maskinens verkliga mått efter valt utförande, valda optioner och,
 * för sista kedjetransportören, efter den längd kunden angett.
 */
export function effectiveMachine(
  base: Machine,
  selectedOptions: string[],
  overrideLengthMm?: number,
  parameters?: Record<string, ParameterValue>,
  variantId?: string,
): EffectiveMachine {
  const machine = resolveVariant(base, variantId);

  let lengthMm = machine.footprint.lengthMm;
  let widthMm = machine.footprint.widthMm;
  let heightMm = machine.footprint.heightMm;
  let capacity = machine.capacity.packagesPerHour;
  let powerKw = machine.utilities.powerKw;

  // Kundens parametrar kan styra mått och kapacitet direkt.
  for (const parameter of machine.parameters ?? []) {
    if (!parameter.affects) continue;
    const raw = parameters?.[parameter.id];
    const value = typeof raw === "number" ? raw : parameter.defaultNumber;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (parameter.affects === "capacity") capacity = Math.max(0, Math.round(value));
    if (parameter.affects === "lengthMm") lengthMm = Math.max(100, Math.round(value));
    if (parameter.affects === "widthMm") widthMm = Math.max(100, Math.round(value));
    if (parameter.affects === "heightMm") heightMm = Math.max(100, Math.round(value));
  }

  for (const optId of selectedOptions) {
    const opt = machine.options.find((o) => o.id === optId);
    if (!opt) continue;
    lengthMm += opt.deltaLengthMm ?? 0;
    widthMm += opt.deltaWidthMm ?? 0;
    capacity += opt.deltaCapacity ?? 0;
    powerKw += opt.deltaPowerKw ?? 0;
  }

  /*
   * Utföranden slår steglös längd. Två sätt att sätta samma mått på samma
   * maskin kan inte båda gälla, och det diskreta är det som finns att köpa:
   * har någon lagt upp 3, 6 och 12 meter är det de längderna som levereras,
   * inte ett värde däremellan. Maskiner utan utföranden påverkas inte.
   */
  const hasVariants = (base.variants?.length ?? 0) > 0;

  if (machine.parametricLength && overrideLengthMm != null && !hasVariants) {
    lengthMm = Math.min(
      machine.parametricLength.maxMm,
      Math.max(machine.parametricLength.minMm, Math.round(overrideLengthMm)),
    );
  }

  return {
    ...machine,
    effLengthMm: lengthMm,
    effWidthMm: widthMm,
    effHeightMm: heightMm,
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

/**
 * Maskinzonen som en lokal box. Fram/bak ligger längs X (flödesriktningen),
 * vänster/höger längs Y — samma konvention som resten av geometrin.
 */
function clearanceZone(m: EffectiveMachine): Zone | null {
  const c = m.clearance;
  if (!c) return null;
  if (c.frontMm <= 0 && c.backMm <= 0 && c.leftMm <= 0 && c.rightMm <= 0) return null;
  return {
    type: "clearance",
    label: `Maskinzon ${m.sku}`,
    box: {
      x: -c.backMm,
      y: -c.leftMm,
      l: m.effLengthMm + c.backMm + c.frontMm,
      w: m.effWidthMm + c.leftMm + c.rightMm,
    },
  };
}

/** Zoner omräknade till maskinens verkliga mått. Se scaleZones. */
function scaledZones(m: EffectiveMachine) {
  const clearance = clearanceZone(m);
  const zones = scaleZones(
    m.zones,
    m.footprint,
    { lengthMm: m.effLengthMm, widthMm: m.effWidthMm },
  );
  return clearance ? [...zones, clearance] : zones;
}

type Cursor = { point: Vec2; dir: Dir };

/** Linjens startpunkt, med ett rimligt utgångsläge om kunden inte flyttat den. */
export function defaultStartPoint(config: Configuration): Vec2 {
  switch (config.flow.infeedFrom) {
    case "right":
      return { x: HALL_INSET_MM, y: config.hall.widthMm - HALL_INSET_MM };
    case "left":
      return { x: HALL_INSET_MM, y: HALL_INSET_MM };
    default:
      return { x: HALL_INSET_MM, y: Math.round(config.hall.widthMm / 2) };
  }
}

function startCursor(config: Configuration): Cursor {
  const point = config.flow.startPoint ?? defaultStartPoint(config);
  switch (config.flow.infeedFrom) {
    // Paketen kommer in från högersidan (+Y) och färdas alltså mot −Y.
    case "right":
      return { point, dir: "y-" };
    case "left":
      return { point, dir: "y+" };
    default:
      return { point, dir: "x+" };
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


/** Boxen utvidgad med maskinens frigång. Riktningsoberoende — vi tar den
 *  största sidan så att zonen respekteras oavsett hur maskinen roterats. */
function expandByClearance(box: Box, m: EffectiveMachine): Box {
  const c = m.clearance;
  if (!c) return box;
  const pad = Math.max(c.frontMm, c.backMm, c.leftMm, c.rightMm);
  if (pad <= 0) return box;
  return { x: box.x - pad, y: box.y - pad, l: box.l + pad * 2, w: box.w + pad * 2 };
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
    // Hjälpobjektet läggs utanför ankarmaskinens maskinzon, inte bara utanför
    // dess kropp — annars hamnar pulpeten inne i det fria utrymmet.
    const a = anchor.zones.find((z) => z.type === "clearance")?.box ?? anchor.bbox;
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

/**
 * Truckgatorna är det kunden ritat — inte något som härleds ur linjens längd.
 * Ibland är det en hel gata längs anläggningen, ibland bara en hämtzon vid
 * utlastningen. Båda är samma sak för motorn: en yta som ska hållas fri.
 */
function drawnAisles(config: Configuration): Aisle[] {
  return config.drawn
    .filter((d) => d.kind === "truck")
    .map((d) => ({
      id: d.id,
      box: { x: d.x, y: d.y, l: d.l, w: d.w },
      label: d.name,
      widthMm: Math.min(d.l, d.w),
    }));
}

/**
 * Ett rimligt förslag på truckgata bredvid utlastningen, som kunden sedan
 * flyttar och ändrar. Används av knappen i sidopanelen och av mallarna.
 */
export function suggestTruckZone(
  lineBounds: Box,
  outDir: Dir,
  side: Side,
): { x: number; y: number; l: number; w: number } {
  const r = rightOf(outDir);
  const s: Vec2 = side === "right" ? r : { x: -r.x, y: -r.y };

  if (s.y !== 0) {
    const y =
      s.y > 0
        ? lineBounds.y + lineBounds.w + AISLE_GAP_MM
        : lineBounds.y - AISLE_GAP_MM - TRUCK_AISLE_MM;
    return {
      x: Math.round(lineBounds.x + lineBounds.l - TRUCK_PICKUP_LENGTH_MM),
      y: Math.round(y),
      l: TRUCK_PICKUP_LENGTH_MM,
      w: TRUCK_AISLE_MM,
    };
  }

  const x =
    s.x > 0
      ? lineBounds.x + lineBounds.l + AISLE_GAP_MM
      : lineBounds.x - AISLE_GAP_MM - TRUCK_AISLE_MM;
  return {
    x: Math.round(x),
    y: Math.round(lineBounds.y + lineBounds.w - TRUCK_PICKUP_LENGTH_MM),
    l: TRUCK_AISLE_MM,
    w: TRUCK_PICKUP_LENGTH_MM,
  };
}

function computeMetrics(
  placements: Placement[],
  aisles: Aisle[],
  bounds: Box,
  endPointGapMm: number | null,
): Metrics {
  const line = placements.filter((p) => !p.aux);
  const withCapacity = line.filter((p) => p.capacity > 0);
  const bottleneckPlacement = withCapacity.reduce<Placement | null>(
    (min, p) => (min === null || p.capacity < min.capacity ? p : min),
    null,
  );

  const area = aisles.length ? unionBox([bounds, ...aisles.map((a) => a.box)]) : bounds;

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
    endPointGapMm,
  };
}

export type SolveOutput = Omit<LayoutResult, "diagnostics"> & {
  /** Enbart produktionskedjans omslutande box, utan hjälpobjekt. */
  lineBounds: Box;
  /** Maskiner som inte gick att koppla in i kedjan. */
  unplaced: { instanceId: string; machineId: string; reason: string }[];
  /** Flödesriktning ut ur sista maskinen. */
  outDir: Dir;
  /** Sant om kedjan aldrig vändes tillbaka till hallens längdriktning. */
  neverTurnedToMainAxis: boolean;
  /** Där linjen faktiskt slutar — sista utportens läge. */
  lineEnd: Vec2 | null;
  /** Längden som sista parametriska maskinen fick, efter eventuell anpassning. */
  finalConveyorLengthMm: number;
};

/**
 * Deterministisk layoutgenerering. Samma konfiguration ger alltid samma
 * geometri — inga slumpmässiga eller modellgenererade placeringar.
 */
type ChainResult = {
  placements: Placement[];
  unplaced: SolveOutput["unplaced"];
  cursor: Cursor;
  turnedToMainAxis: boolean;
};

/** Bygger kedjan med en given längd på den parametriska maskinen. */
function walkChain(
  config: Configuration,
  lineItems: { item: LineItem; machine: Machine }[],
  parametricIndex: number,
  finalLengthMm: number,
  preferMirrored: boolean,
): ChainResult {
  const placements: Placement[] = [];
  const unplaced: SolveOutput["unplaced"] = [];
  const idealBoxes: Box[] = [];
  // Samma boxar utvidgade med maskinzonen, så att kedjan lägger sig fritt.
  const idealClearBoxes: Box[] = [];

  let cursor = startCursor(config);
  let turnedToMainAxis = cursor.dir === "x+";

  lineItems.forEach(({ item, machine }, index) => {
    const eff = effectiveMachine(
      machine,
      item.selectedOptions,
      index === parametricIndex ? finalLengthMm : undefined,
      item.parameters,
      item.variantId,
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

    /*
     * Skjut fram markören tills maskinen står fri. Tidigare maskiner räknas
     * med sin maskinzon — utom den närmast föregående, som är inkopplad port
     * mot port och därför med rätta står i frigången framåt.
     */
    const blockers = [...idealClearBoxes.slice(0, -1), ...idealBoxes.slice(-1)];
    for (let attempt = 0; attempt < MAX_CLEARANCE_ATTEMPTS; attempt++) {
      const shift = clearanceShift(result.idealBbox, blockers, cursor.dir, TURN_CLEARANCE_MM);
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
    idealClearBoxes.push(expandByClearance(result.idealBbox, eff));
    cursor = result.next;
    if (cursor.dir === "x+") turnedToMainAxis = true;
  });

  return { placements, unplaced, cursor, turnedToMainAxis };
}

export function solveLayout(
  config: Configuration,
  library: MachineLibrary = BUILTIN_LIBRARY,
): SolveOutput {
  const preferMirrored = config.flow.controlDeskSide === "left";

  const resolved = config.line
    .map((item) => ({ item, machine: getMachine(item.machineId, library) }))
    .filter((r): r is { item: LineItem; machine: Machine } => !!r.machine);

  const lineItems = resolved.filter((r) => !r.machine.aux);
  const auxItems = resolved.filter((r) => r.machine.aux);

  /*
   * Sista transportmaskinen med parametrisk längd styrs av flödesfrågan —
   * men bara om maskinen faktiskt går att kapa till längd.
   *
   * En maskin med uppmätt CAD-modell har den längd den har. Att sträcka en
   * tre meter lång rullbana till tolv vore att rita något som inte finns, och
   * det syntes: modellen skalades upp fyra gånger så att rullarna blev
   * enorma. Samma sak för utföranden — där är längderna redan bestämda.
   */
  const parametricIndex = (() => {
    for (let i = lineItems.length - 1; i >= 0; i--) {
      const m = lineItems[i].machine;
      if (m.parametricLength && !m.model && !(m.variants?.length ?? 0)) return i;
    }
    return -1;
  })();

  let finalLengthMm = config.flow.finalConveyorLengthMm;
  let chain = walkChain(config, lineItems, parametricIndex, finalLengthMm, preferMirrored);

  /*
   * Ska linjen sluta i en angiven punkt sätts den parametriska maskinens längd
   * så att sista utporten hamnar där. Slutsegmentet är rakt, så en enda
   * korrigering räcker — men vi kör om kedjan för att få exakt geometri.
   */
  if (config.flow.fitToEndPoint && config.flow.endPoint && parametricIndex >= 0) {
    const limits = lineItems[parametricIndex].machine.parametricLength;
    const v = DIR_VEC[chain.cursor.dir];
    const delta =
      (config.flow.endPoint.x - chain.cursor.point.x) * v.x +
      (config.flow.endPoint.y - chain.cursor.point.y) * v.y;

    const wanted = Math.round(finalLengthMm + delta);
    const clamped = limits
      ? Math.min(limits.maxMm, Math.max(limits.minMm, wanted))
      : Math.max(500, wanted);

    if (clamped !== finalLengthMm) {
      finalLengthMm = clamped;
      chain = walkChain(config, lineItems, parametricIndex, finalLengthMm, preferMirrored);
    }
  }

  const placements = [...chain.placements];
  const linePlacements = placements.filter((p) => !p.aux);
  const lineBounds = unionBox(linePlacements.map((p) => p.bbox));

  // Hjälpobjekt placeras relativt sin ankarmaskin.
  for (const { item, machine } of auxItems) {
    const eff = effectiveMachine(
      machine,
      item.selectedOptions,
      undefined,
      item.parameters,
      item.variantId,
    );
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

    const anchorDir = anchor?.ports.find((p) => p.role === "out")?.dir ?? chain.cursor.dir;
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
  const outDir = chain.cursor.dir;
  const aisles = drawnAisles(config);

  const lineEnd = linePlacements.length ? chain.cursor.point : null;
  const endPointGapMm =
    config.flow.endPoint && lineEnd
      ? Math.round(
          Math.hypot(
            config.flow.endPoint.x - lineEnd.x,
            config.flow.endPoint.y - lineEnd.y,
          ),
        )
      : null;

  return {
    placements,
    aisles,
    bounds,
    lineBounds,
    metrics: computeMetrics(placements, aisles, bounds, endPointGapMm),
    unplaced: chain.unplaced,
    outDir,
    neverTurnedToMainAxis: !chain.turnedToMainAxis,
    lineEnd,
    finalConveyorLengthMm: finalLengthMm,
  };
}

export { DIR_VEC };
