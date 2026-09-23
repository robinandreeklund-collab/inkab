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

export type ZoneType = "service" | "safety" | "pit" | "clearance";

export type Port = {
  id: string;
  /**
   * Vad utgången heter för den som väljer den: "Rakt fram", "Ut på
   * kortsidan". En maskin kan ha flera utgångar — en rullbana kan lämna
   * paketet framåt eller ut åt sidan — och då måste de gå att skilja åt med
   * något annat än ett id.
   */
  name?: string;
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

/**
 * Kundvända parametrar som admin definierar per maskin. Kunden ser dem när
 * maskinen är markerad, t.ex. "önskad virkestakt".
 */
export type ParameterValue = string | number | boolean;

export type MachineParameter = {
  id: string;
  label: string;
  help?: string;
  type: "number" | "select" | "boolean";
  /** Vad parametern styr i motorn. Utelämnas om den bara ska dokumenteras. */
  affects?: "capacity" | "lengthMm" | "widthMm" | "heightMm";

  /** type: "number" */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Pris per enhet av värdet, SEK. */
  pricePerUnit?: number;

  /** type: "select" */
  choices?: { value: string; label: string; priceDelta?: number }[];

  defaultNumber?: number;
  defaultText?: string;
  defaultBoolean?: boolean;
  /** Pristillägg när en boolean är påslagen. */
  priceWhenTrue?: number;
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
  /** Kort beskrivning i gränssnittet. */
  summary: string;
  /**
   * Utförlig beskrivning för assistenten: vad maskinen gör, vad den är till
   * för, vad den klarar och inte klarar, när den ska väljas. Läggs in i
   * systemprompten i sin helhet — det är härifrån assistenten vet vad
   * maskinen faktiskt är.
   */
  aiDescription?: string;
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
  /**
   * Maskinzon: fritt utrymme som måste hållas runt maskinen. Avstånden anges
   * per sida i maskinens egen orientering — fram är i flödesriktningen.
   * Inget får placeras innanför.
   */
  clearance?: {
    frontMm: number;
    backMm: number;
    leftMm: number;
    rightMm: number;
  };

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
  /**
   * Arbetstid, timmar. Tillverkning i verkstad och montage på plats hålls
   * isär: de utförs av olika personer, faktureras olika och behöver planeras
   * var för sig.
   */
  manufacturingHours?: number;
  assemblyHours?: number;
  /** Nummer i INKAB:s produktkatalog. "—" för poster utanför katalogen. */
  catalogueNumber?: string;
  /**
   * Sant när fotavtryck och portlägen är kontrollerade mot verklig ritning.
   * Falskt betyder uppskattade mått som inte får visas för kund utan förbehåll.
   */
  dimensionsVerified?: boolean;
  options: MachineOption[];

  /** Kundvända inställningar, definierade av admin. */
  parameters?: MachineParameter[];
  /** Id på bilder i biblioteksdokumentets assets. */
  images?: string[];
  /**
   * Webbmodeller framtagna av scripts/step-to-glb.mjs. GLB ligger i
   * objektlagring eller under public/, aldrig i biblioteksdokumentet.
   */
  /**
   * Utföranden av samma maskin — samma konstruktion i olika längder.
   * En rullbana finns som 3, 6 och 12 meter; det är inte tre maskiner utan
   * en maskin med tre mått. Kunden väljer utförande i konfiguratorn, och
   * varje utförande bär sin egen modell och sina egna mått, mätta ur sin
   * egen STEP-fil.
   */
  variants?: MachineVariant[];

  model?: {
    glb: string;
    /** Kraftigt förenklad variant för översikt. Valfri. */
    proxy?: string;
    /**
     * Hur modellen ska vridas för att stämma med maskinens riktning.
     * Justeras vid uppritningen, se lib/cad/orientation.ts.
     */
    upAxis?: "z" | "y";
    yawDeg?: 0 | 90 | 180 | 270;
    flipped?: boolean;
  };
  /** Länkar till produktkatalog och datablad. */
  productUrl?: string;
  datasheetUrl?: string;
};

/* ── Konfiguration ─────────────────────────────────────────────────────── */

export type LineItem = {
  instanceId: string;
  machineId: string;
  /** Valt utförande. Utelämnas används maskinens första variant, om någon. */
  variantId?: string;
  /**
   * Var maskinen står i hallen: dess origo i millimeter.
   *
   * Positionen är kundens, inte uträknad. Maskinerna kopplades förut ihop
   * port mot port och en solver räknade fram var var och en hamnade; det gav
   * en enda auktoritet över placeringen, men också en anläggning som bara
   * gick att bygga på ett sätt. Nu står maskinen där någon lagt den.
   *
   * Utelämnas — i en sparad konfiguration från tiden före fri placering —
   * får posten en plats på ledig yta när layouten räknas ut.
   */
  pos?: Vec2;
  /** Hur maskinen är vriden. Utelämnas står den som i katalogen. */
  rotation?: Rotation;
  /** Spegelvänd, för maskiner som går att få i höger- och vänsterutförande. */
  mirrored?: boolean;
  /**
   * Längd i millimeter, för maskiner som kapas till mått.
   *
   * Låg förut i flödesfrågan "längd på sista kedjetransportören", vilket bara
   * kunde gälla en maskin i hela anläggningen. Längden hör till maskinen.
   */
  lengthMm?: number;
  selectedOptions: string[];
  /** Kundens värden på maskinens parametrar. */
  parameters?: Record<string, ParameterValue>;
  /**
   * Kundens egen anteckning om just den här maskinen.
   *
   * "Befintlig, flyttas från hall 2", "kunden vill ha extra lyft här".
   * Sådant som inte går att uttrycka i mått eller optioner men som den som
   * läser offerten behöver veta. Den följer med till offertunderlaget och
   * påverkar varken geometri eller pris.
   */
  note?: string;
};

/**
 * Objekt kunden ritar i hallen.
 *  wall  — vägg, alltid axelparallell
 *  door  — port i en vägg; truckens väg in och ut
 *  truck — truckgata eller hämtzon. Definieras av kunden, inte av linjen.
 *  nogo  — spärrad yta
 */
export type DrawnKind = "wall" | "door" | "truck" | "nogo";

export type DrawnObject = {
  id: string;
  kind: DrawnKind;
  name: string;
  /** Världsbox, mm. */
  x: number;
  y: number;
  l: number;
  w: number;
  h: number;
};

export type Flow = {
  /** "Från vilken sida hämtar trucken färdiga paket" — styr förslaget på truckgata. */
  truckPickupSide: Side;
  /** Var den första maskinen läggs när hallen är tom. Kan dras i ritningen. */
  startPoint: Vec2;
};

export type Hall = {
  lengthMm: number;
  widthMm: number;
  clearHeightMm: number;
};

export type Product = {
  packageLengthMm: number;
  /** Minsta virkesbredd (paketbredd) som ska kunna köras. */
  packageWidthMinMm: number;
  /** Största virkesbredd (paketbredd) som ska kunna köras. */
  packageWidthMaxMm: number;
  packageHeightMm: number;
  packageWeightKg: number;
  targetPackagesPerHour: number;
};

/**
 * Ett utförande. Måtten kommer ur variantens egen CAD-modell och är därmed
 * mätta, inte uppskattade. Priser står aldrig här — maskinbiblioteket går
 * till webbläsaren, prisboken gör det aldrig.
 */
export type MachineVariant = {
  id: string;
  /** Vad kunden ser: "3 m", "6 m", "12 m". */
  name: string;
  footprint: { lengthMm: number; widthMm: number; heightMm: number };
  /** Egna portlägen. Utelämnas de skalas basmaskinens mot variantens mått. */
  ports?: Port[];
  model?: {
    glb: string;
    proxy?: string;
    upAxis?: "z" | "y";
    yawDeg?: 0 | 90 | 180 | 270;
    flipped?: boolean;
  };
  /** Avvikande kapacitet, om utförandet ändrar den. */
  packagesPerHour?: number;
  /** Sant när måtten är kontrollerade mot ritning. */
  dimensionsVerified?: boolean;
};

export type Configuration = {
  version: 1;
  projectName: string;
  /**
   * Uppgifter som bara står på offertunderlaget. De påverkar varken layouten
   * eller priset, och ingår därför inte i underlagsnumret.
   */
  customer?: {
    company?: string;
    contact?: string;
    /** Kundens eget referens- eller projektnummer. */
    reference?: string;
    site?: string;
  };
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

/** En truckgata eller hämtzon, härledd ur det kunden ritat. */
export type Aisle = { id: string; box: Box; label: string; widthMm: number };

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
  /** Summerad arbetstid för anläggningen, timmar. */
  manufacturingHours: number;
  assemblyHours: number;
  /** Avstånd mellan linjens faktiska slut och önskad slutpunkt, mm. */
};

export type LayoutResult = {
  placements: Placement[];
  /** Truckgator och hämtzoner. Tomt tills kunden ritat någon. */
  aisles: Aisle[];
  bounds: Box;
  metrics: Metrics;
  diagnostics: Diagnostic[];
};
