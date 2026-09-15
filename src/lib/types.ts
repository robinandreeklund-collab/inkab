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

/* ── Flödesskelettet ───────────────────────────────────────────────────── */

/**
 * En punkt i flödet kunden ritar.
 *
 *  infeed    — där paket kommer in i anläggningen. En gren börjar här.
 *  junction  — där grenar möts eller delar sig.
 *  outfeed   — där paket lämnar anläggningen.
 */
export type FlowNodeKind = "infeed" | "junction" | "outfeed";

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  name: string;
  /** Läget i hallen, mm. */
  at: Vec2;
  /** Riktningen flödet lämnar noden med. Saknar mening på en utlastningsnod. */
  dir: Dir;
};

/**
 * En sträcka mellan två noder. Maskinerna som står på den ligger kvar i
 * linjelistan och pekar hit med `edgeId`.
 */
export type FlowEdge = {
  id: string;
  name: string;
  fromNodeId: string;
  /** Null medan sträckan ritas, eller när den slutar fritt i hallen. */
  toNodeId: string | null;
  /**
   * Sträck sträckans kapbara transportör så att den når fram till målnoden.
   * Avstängd som standard: diagnostiken mäter glappet och erbjuder åtgärden,
   * på samma sätt som slutpunkten alltid har fungerat.
   */
  fit?: boolean;
};

/**
 * Flödet som graf.
 *
 * Linjen har hittills varit ett träd med en rot: varje maskin har en
 * föregångare, grenar hänger på utgångar. Två inmatningar som möts på en
 * gemensam bana går inte att uttrycka så — det finns ingen plats att säga
 * "här går de ihop".
 *
 * Skelettet vänder på ordningen. Kunden ritar flödet först: var paketen
 * kommer in, var vägarna möts, var de delar sig och var de går ut. Sedan
 * hänger maskinerna på varje sträcka. Geometrin kommer fortfarande ur
 * maskinerna — skelettet säger riktning, ordning och kopplingar, aldrig mått.
 * Går det ritade och det verkliga isär säger diagnostiken det i stället för
 * att någondera tyst vinner.
 *
 * Utan graf är allt precis som förut: linjen är trädet, och `branch` styr.
 */
export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type LineItem = {
  instanceId: string;
  machineId: string;
  /** Sträckan i flödesskelettet maskinen står på. Utan graf: utelämnad. */
  edgeId?: string;
  /** Valt utförande. Utelämnas används maskinens första variant, om någon. */
  variantId?: string;
  /**
   * Vilken utgång linjen fortsätter ur, för maskiner med flera. Utelämnas
   * används den första.
   */
  outPortId?: string;
  /**
   * Grenrot: maskinen sitter på en annan maskins utgång i stället för på den
   * föregående i listan. Allt som följer i listan hör till samma gren tills
   * nästa grenrot.
   *
   * Linjen är alltså ett träd, lagrat som en platt lista. Listan behåller
   * ordningen för offert, ångra och numrering; grenarna ligger i länkarna.
   */
  branch?: { fromInstanceId: string; outPortId: string };
  selectedOptions: string[];
  /** Kundens värden på maskinens parametrar. */
  parameters?: Record<string, ParameterValue>;
  /** Manuell justering av den genererade placeringen, mm. */
  manualOffset?: Vec2;
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

  /** Var linjen börjar i hallen. Kan dras i ritningen. */
  startPoint: Vec2;
  /** Önskad slutpunkt för linjen. Null = ingen målpunkt angiven. */
  endPoint: Vec2 | null;
  /**
   * Sätter sista kedjetransportörens längd automatiskt så att linjen slutar
   * vid slutpunkten. Kräver att endPoint är satt.
   */
  fitToEndPoint: boolean;
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
  /**
   * Flödet som graf, när kunden ritat det. Utelämnad betyder att linjen är
   * ett träd som förut — se FlowGraph.
   */
  flowGraph?: FlowGraph;
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
  | { kind: "removeMachine"; instanceId: string; label: string }
  /** Låter en grens kapbara transportör sträckas fram till sin målnod. */
  | { kind: "fitEdge"; edgeId: string; label: string };

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
  endPointGapMm: number | null;
};

/**
 * Vad som hände på en ritad sträcka.
 *
 * Solvern räknar fram det, reglerna dömer på det och gränssnittet visar det —
 * samma tal på alla tre ställen. Glappet är det viktiga: avståndet mellan där
 * maskinerna faktiskt slutar och den punkt kunden ritade.
 */
export type EdgeRun = {
  edgeId: string;
  /** Sista utportens läge och riktning, eller null när inget kunde placeras. */
  end: { point: Vec2; dir: Dir } | null;
  /** Avståndet mellan sträckans slut och den ritade målnoden, mm. */
  gapMm: number | null;
  /** Kapbar maskin på sträckan, som kan sträckas för att nå fram. */
  fittable: { instanceId: string; lengthMm: number; limits?: { minMm: number; maxMm: number } } | null;
  /** Maskiner som står på sträckan. */
  count: number;
  /** Kapaciteten sträckan lämnar ifrån sig, paket/h. */
  throughput: number;
  /** Höjden paketet ligger på när det lämnar sträckan, mm. */
  levelMm: number | null;
};

export type LayoutResult = {
  placements: Placement[];
  /** Truckgator och hämtzoner. Tomt tills kunden ritat någon. */
  aisles: Aisle[];
  bounds: Box;
  metrics: Metrics;
  diagnostics: Diagnostic[];
  /** Resultat per ritad sträcka. Tom lista när flödet inte är ritat. */
  edgeRuns: EdgeRun[];
};
