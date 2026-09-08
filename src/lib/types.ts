/**
 * Domänmodell för INKAB Layout Configurator.
 *
 * KOORDINATSYSTEM (all geometri i heltal millimeter)
 * --------------------------------------------------
 * Värld:  X = längs hallen, Y = tvärs hallen, Z = uppåt.
 * Planvy: X åt höger, Y nedåt.
 * Konvention: med blicken i flödesriktningen är "höger" = +Y och "vänster" = −Y.
 *
 * Maskinens lokala system: origo i maskinens minhörn,
 * X = 0..length, Y = 0..width, Z = 0..height.
 */

export type Vec2 = { x: number; y: number };
export type Dir = "x+" | "x-" | "y+" | "y-";
export type Rotation = 0 | 90 | 180 | 270;
export type Side = "right" | "left";

export type MachineCategory =
  | "infeed"
  | "stacking"
  | "stickers"
  | "transport"
  | "processing"
  | "finishing"
  | "outfeed"
  | "control";

export type ZoneType = "service" | "safety" | "pit";

export type Port = {
  id: string;
  role: "in" | "out";
  /** Lokal position, mm. */
  pos: Vec2;
  /** Flödesriktning genom porten, i lokalt system. */
  dir: Dir;
  /** Produktens höjd över golv i porten, mm. */
  levelMm: number;
  /** Tillåten produktbredd [min, max], mm. */
  widthMm: [number, number];
  /** Sant om porten kan ta emot/lämna i annan riktning än maskinens huvudflöde. */
  allowsDirectionChange: boolean;
};

export type Zone = {
  type: ZoneType;
  /** Lokal box, mm. */
  box: { x: number; y: number; l: number; w: number };
  label: string;
};

export type MachineOption = {
  id: string;
  name: string;
  /** Påverkar geometrin additivt, mm. */
  deltaLengthMm?: number;
  deltaWidthMm?: number;
  deltaCapacity?: number;
  deltaPowerKw?: number;
};

export type Machine = {
  id: string;
  sku: string;
  name: string;
  category: MachineCategory;
  summary: string;
  /** Hjälpobjekt (pulpet, magasin) ingår inte i produktionskedjan. */
  aux?: boolean;
  /** Ankarmaskin som hjälpobjektet placeras intill. */
  anchorFor?: string;

  footprint: { lengthMm: number; widthMm: number; heightMm: number };
  ports: Port[];
  /** Kan speglas över sin längdaxel för att byta manöversida. */
  mirrorable: boolean;
  /** Längden styrs av konfigurationen (sista kedjetransportören). */
  parametricLength?: { minMm: number; maxMm: number; pricePerMeter: number };
  /** Högre värde = mer manuellt arbete; styr var pulpeten hamnar. */
  operatorPriority?: number;

  zones: Zone[];

  capacity: {
    packagesPerHour: number;
    packageLengthMm: [number, number];
    packageWidthMm: [number, number];
    packageHeightMm: [number, number];
    maxWeightKg: number;
  };

  utilities: { powerKw: number; airNlPerMin: number };
  foundation: { pitDepthMm: number; pointLoadKn: number };

  requires?: string[];
  conflictsWith?: string[];

  stepFile?: string;
  leadTimeWeeks: number;
  options: MachineOption[];
};

/* ── Konfiguration ─────────────────────────────────────────────────────── */

export type LineItem = {
  instanceId: string;
  machineId: string;
  selectedOptions: string[];
  /** Manuell justering av den genererade placeringen, mm. */
  manualOffset?: Vec2;
};

export type DrawnObject = {
  id: string;
  kind: "wall" | "nogo";
  name: string;
  /** Världsbox, mm. */
  x: number;
  y: number;
  l: number;
  w: number;
  h: number;
};

export type Flow = {
  /** "Kommer paketen in från: Rakt / Höger / Vänster" */
  infeedFrom: "straight" | "right" | "left";
  /** "Vilken sida ska pulpeten stå på" */
  controlDeskSide: Side;
  /** "Vilken sida ska ströfacksmagasinet stå på" */
  stickerMagazineSide: Side;
  /** "Från vilken sida hämtar trucken färdiga paket" */
  truckPickupSide: Side;
  /** "Längd på sista kedjetransportören" */
  finalConveyorLengthMm: number;
};

export type Hall = {
  lengthMm: number;
  widthMm: number;
  clearHeightMm: number;
};

export type Product = {
  packageLengthMm: number;
  packageWidthMm: number;
  packageHeightMm: number;
  packageWeightKg: number;
  targetPackagesPerHour: number;
};

export type Configuration = {
  version: 1;
  projectName: string;
  hall: Hall;
  flow: Flow;
  product: Product;
  line: LineItem[];
  drawn: DrawnObject[];
};

/* ── Layoutresultat ────────────────────────────────────────────────────── */

export type Box = { x: number; y: number; l: number; w: number };

export type PlacedPort = { id: string; role: "in" | "out"; pos: Vec2; dir: Dir; levelMm: number };

export type Placement = {
  instanceId: string;
  machineId: string;
  machine: Machine;
  /** Index i produktionskedjan, 1-baserat. 0 för hjälpobjekt. */
  pos: number;
  aux: boolean;
  /** Världsposition för maskinens lokala origo. */
  origin: Vec2;
  rotation: Rotation;
  mirrored: boolean;
  /** Effektiva mått efter optioner och parametrisering, mm. */
  size: { lengthMm: number; widthMm: number; heightMm: number };
  /** Axelparallell världsbox. */
  bbox: Box;
  ports: PlacedPort[];
  zones: { type: ZoneType; label: string; box: Box }[];
  capacity: number;
  powerKw: number;
};

export type Aisle = { box: Box; label: string; side: Side; widthMm: number };

export type Severity = "error" | "warning" | "info";

export type ConfigPatch =
  | { kind: "flow"; patch: Partial<Flow>; label: string }
  | { kind: "addMachine"; machineId: string; label: string }
  | { kind: "removeMachine"; instanceId: string; label: string };

export type Diagnostic = {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  instanceIds: string[];
  /** Markeringspunkt i världen för badge i vyn. */
  anchor?: Vec2;
  fix?: ConfigPatch;
};

export type Metrics = {
  totalLengthMm: number;
  totalWidthMm: number;
  maxHeightMm: number;
  footprintM2: number;
  throughputPerHour: number;
  bottleneck: { instanceId: string; name: string; capacity: number } | null;
  totalPowerKw: number;
  totalAirNlPerMin: number;
  pitCount: number;
  leadTimeWeeks: number;
};

export type LayoutResult = {
  placements: Placement[];
  aisle: Aisle | null;
  bounds: Box;
  metrics: Metrics;
  diagnostics: Diagnostic[];
};
