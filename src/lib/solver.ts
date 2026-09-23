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
/** Avstånd mellan maskiner som läggs ut på rad utan angiven plats, mm. */
const PLACEMENT_GAP_MM = 800;
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

  /*
   * En uppmätt CAD-modell har den längd den har. Att sträcka en tre meter
   * lång rullbana till tolv vore att rita något som inte finns, och det
   * syntes: modellen skalades upp fyra gånger så att rullarna blev enorma.
   * Kontrollen låg förut i solvern, som valde ut vilken maskin längden
   * gällde. Längden är maskinens egen nu, så kontrollen hör hemma här.
   */
  if (machine.parametricLength && overrideLengthMm != null && !hasVariants && !machine.model) {
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

/** Linjens startpunkt, med ett rimligt utgångsläge om kunden inte flyttat den. */
/** Var den första maskinen hamnar när hallen är tom. */
export function defaultStartPoint(config: Configuration): Vec2 {
  return {
    x: HALL_INSET_MM,
    y: Math.round(config.hall.widthMm / 2),
  };
}

/**
 * Placerar en maskin där den står.
 *
 * Positionen är kundens. Förut räknades den fram: maskinerna kopplades ihop
 * port mot port och en solver vandrade kedjan framåt. Det gav en anläggning
 * som bara gick att bygga på ett sätt, och en placering som hoppade så fort
 * något ändrades längre upp i kedjan. Nu står maskinen där någon lagt den,
 * och portarna är bara en ritning av vad maskinen klarar.
 */
function placeAt(
  item: LineItem,
  m: EffectiveMachine,
  pos: number,
  origin: Vec2,
): Placement {
  const rotation = item.rotation ?? 0;
  const mirrored = item.mirrored ?? false;
  const opts = { rotation, mirrored, widthMm: m.effWidthMm };
  const full = { ...opts, origin };

  return {
    instanceId: item.instanceId,
    machineId: m.id,
    machine: m,
    pos,
    aux: !!m.aux,
    origin,
    rotation,
    mirrored,
    size: { lengthMm: m.effLengthMm, widthMm: m.effWidthMm, heightMm: m.effHeightMm },
    bbox: boxToWorld({ x: 0, y: 0, l: m.effLengthMm, w: m.effWidthMm }, full),
    ports: scaledPorts(m).map((port) => ({
      id: port.id,
      role: port.role,
      pos: toWorld(port.pos, full),
      dir: transformDir(port.dir, opts),
      levelMm: port.levelMm,
    })),
    zones: scaledZones(m).map((z) => ({ type: z.type, label: z.label, box: boxToWorld(z.box, full) })),
    capacity: m.effCapacity,
    powerKw: m.effPowerKw,
  };
}

/**
 * En ledig plats åt en maskin som saknar position.
 *
 * Gäller två fall: en konfiguration sparad före fri placering, och en maskin
 * som läggs till utan att någon pekat ut var. Den läggs till höger om det som
 * redan står — och när raden når hallens gavel börjar en ny rad under.
 *
 * Inte för att det är rätt plats, utan för att den ska synas och gå att dra
 * dit den ska. Utanför hallen är ingen plats: där syns den knappt, och
 * regel R-401 anmärker på den direkt.
 */
export function freeSpot(
  taken: Box[],
  size: { l: number; w: number },
  start: Vec2,
  hall?: { lengthMm: number; widthMm: number },
): Vec2 {
  if (taken.length === 0) return { x: start.x, y: Math.round(start.y - size.w / 2) };

  const right = Math.max(...taken.map((b) => b.x + b.l));
  const x = Math.round(right + PLACEMENT_GAP_MM);
  const y = Math.round(start.y - size.w / 2);
  if (!hall || x + size.l <= hall.lengthMm) return { x, y };

  // Raden är full: börja om vid hallens vänsterkant, under det som står.
  const bottom = Math.max(...taken.map((b) => b.y + b.w));
  return { x: HALL_INSET_MM, y: Math.round(bottom + PLACEMENT_GAP_MM) };
}

/**
 * Ytan en maskin gör anspråk på: kroppen plus maskinzonen om den har någon.
 *
 * Raden mäts mot den, inte mot kroppen. Annars hamnar nästa maskin inne i
 * maskinzonen — vilket regel R-106 med rätta anmärker på direkt när en tom
 * mall öppnas.
 */
export function claimedBox(p: Placement): Box {
  return p.zones.find((z) => z.type === "clearance")?.box ?? p.bbox;
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

function computeMetrics(placements: Placement[], aisles: Aisle[], bounds: Box): Metrics {
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
    /*
     * Arbetstiden summeras, till skillnad från leveranstiden som är den
     * längsta: maskinerna byggs efter varandra av samma verkstad, medan de
     * beställs parallellt.
     */
    manufacturingHours: placements.reduce((h, p) => h + (p.machine.manufacturingHours ?? 0), 0),
    assemblyHours: placements.reduce((h, p) => h + (p.machine.assemblyHours ?? 0), 0),
  };
}

export type SolveOutput = Omit<LayoutResult, "diagnostics"> & {
  /** Maskinernas omslutande box, utan hjälpobjekt. */
  lineBounds: Box;
  /** Maskiner i konfigurationen som inte finns i biblioteket. */
  unplaced: { instanceId: string; machineId: string; reason: string }[];
};

/**
 * Bygger layouten ur konfigurationen.
 *
 * Ren funktion: samma konfiguration ger alltid exakt samma geometri, på
 * klienten och på servern. Den räknar inte längre ut VAR maskinerna ska stå
 * — det bestämmer den som bygger — utan bara vad de upptar: kropp, portar
 * och zoner i hallens koordinater.
 */
export function solveLayout(
  config: Configuration,
  library: MachineLibrary = BUILTIN_LIBRARY,
): SolveOutput {
  const start = config.flow.startPoint ?? defaultStartPoint(config);
  const placements: Placement[] = [];
  const unplaced: SolveOutput["unplaced"] = [];

  const resolved = config.line
    .map((item) => ({ item, machine: getMachine(item.machineId, library) }))
    .filter((r) => {
      if (r.machine) return true;
      unplaced.push({
        instanceId: r.item.instanceId,
        machineId: r.item.machineId,
        reason: "Maskinen finns inte i biblioteket.",
      });
      return false;
    }) as { item: LineItem; machine: Machine }[];

  let pos = 0;
  const numbered = resolved.map(({ item, machine }) => {
    if (!machine.aux) pos += 1;
    return {
      item,
      eff: effectiveMachine(
        machine,
        item.selectedOptions,
        item.lengthMm,
        item.parameters,
        item.variantId,
      ),
      pos: machine.aux ? 0 : pos,
    };
  });

  /*
   * Två svep: först de som har en position, sedan de som saknar en.
   *
   * En post utan position är antingen sparad före fri placering eller nyss
   * tillagd utan att någon pekat ut var. Den ska hamna på ledig yta — och
   * ledig betyder fri från ALLT som står i hallen, också det som kommer
   * senare i listan. Ett enda svep skulle bara se bakåt och lägga den rakt
   * ovanpå en maskin längre ner.
   */
  for (const { item, eff, pos } of numbered) {
    if (item.pos) placements.push(placeAt(item, eff, pos, item.pos));
  }
  for (const { item, eff, pos } of numbered) {
    if (item.pos) continue;
    const origin = freeSpot(
      placements.map(claimedBox),
      { l: eff.effLengthMm, w: eff.effWidthMm },
      start,
      config.hall,
    );
    placements.push(placeAt(item, eff, pos, origin));
  }

  // Tillbaka till listans ordning: den styr numrering, offert och remsa.
  const order = new Map(config.line.map((i, at) => [i.instanceId, at]));
  placements.sort((a, b) => (order.get(a.instanceId) ?? 0) - (order.get(b.instanceId) ?? 0));

  const linePlacements = placements.filter((p) => !p.aux);
  const lineBounds = unionBox(linePlacements.map((p) => p.bbox));
  const bounds = unionBox(placements.map((p) => p.bbox));
  const aisles = drawnAisles(config);

  return {
    placements,
    aisles,
    bounds,
    lineBounds,
    metrics: computeMetrics(placements, aisles, bounds),
    unplaced,
  };
}

export { DIR_VEC };
