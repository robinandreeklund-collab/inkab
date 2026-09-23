import { defaultStartPoint, solveLayout, suggestTruckZone } from "./solver";
import { BUILTIN_LIBRARY, type MachineLibrary } from "./library";
import type { Configuration, Flow, Hall, LineItem, Product } from "./types";

let counter = 0;
export function newInstanceId(machineId: string): string {
  counter += 1;
  return `${machineId}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function lineItem(machineId: string, selectedOptions: string[] = []): LineItem {
  return { instanceId: newInstanceId(machineId), machineId, selectedOptions };
}

export const DEFAULT_HALL: Hall = { lengthMm: 46000, widthMm: 22500, clearHeightMm: 6000 };

/**
 * Utgångsvärden hämtade ur katalogen: truckströ är 800–1150 mm långa, vilket
 * spänner paketets bredd, och tillåtna pakethöjder är 300–1200 mm.
 */
export const DEFAULT_PRODUCT: Product = {
  packageLengthMm: 5400,
  packageWidthMinMm: 800,
  packageWidthMaxMm: 1150,
  packageHeightMm: 1100,
  packageWeightKg: 1800,
  targetPackagesPerHour: 18,
};

export const DEFAULT_FLOW: Flow = {
  truckPickupSide: "left",
  startPoint: { x: 2000, y: Math.round(DEFAULT_HALL.widthMm / 2) },
};

function base(projectName: string, machineIds: string[]): Configuration {
  return {
    version: 1,
    projectName,
    hall: { ...DEFAULT_HALL },
    flow: { ...DEFAULT_FLOW },
    product: { ...DEFAULT_PRODUCT },
    line: machineIds.map((id) => lineItem(id)),
    drawn: [],
  };
}

export type Template = {
  id: string;
  name: string;
  description: string;
  machineIds: string[];
  /** Avvikelser från standardhallen och standardflödet för just denna mall. */
  hall?: Partial<Hall>;
  flow?: Partial<Flow>;
};

export const TEMPLATES: Template[] = [
  {
    id: "strolinje",
    name: "Truckströläggning – enkel",
    description:
      "Rullbana in, truckströläggare med magasin, lättpress, bandomföring och buffert ut.",
    machineIds: [
      "rullbana",
      "tsl-enkel",
      "lattpress",
      "bandomforing",
      "kedjetransportor",
      "manoverpulpet",
      "strofacksmagasin",
    ],
  },
  {
    id: "multilinje",
    name: "Truckströläggning – multi",
    description:
      "Multiströläggare med vakuumlyft, hydraulisk press och automatisk bandomföring.",
    machineIds: [
      "rullbana",
      "tsl-multi",
      "paketpress-hydraulisk",
      "bandomforing-spjut",
      "kedjetransportor",
      "manoverpulpet",
      "strofacksmagasin",
    ],
    hall: { lengthMm: 54000, widthMm: 26000 },
  },
  {
    id: "underslag",
    name: "Underslagsläggning",
    description:
      "Underslagsläggare med höj- och sänkbar transportör, sidoskydd och bandning.",
    machineIds: [
      "rullbana",
      "rullbana-underslag",
      "underslagslaggare",
      "sidoskyddslaggare",
      "bandomforing",
      "kedjetransportor",
      "manoverpulpet",
    ],
    hall: { lengthMm: 58000, widthMm: 24000 },
  },
  {
    id: "komplett",
    name: "Komplett pakethantering",
    description:
      "Ströläggning, press, sidoskydd, bandning och emballering fram till utlastning.",
    machineIds: [
      "rullbana",
      "tsl-multi",
      "paketpress-hydraulisk",
      "sidoskyddslaggare",
      "bandomforing-spjut",
      "emballageutlaggare",
      "kedjetransportor",
      "manoverpulpet",
      "strofacksmagasin",
    ],
    hall: { lengthMm: 72000, widthMm: 30000 },
  },
];

/**
 * Mallen som en färdig konfiguration, med maskinernas positioner inskrivna.
 *
 * Biblioteket måste vara detsamma som vyn sedan ritar med. Måtten kommer
 * därifrån, och en rad lagd efter inbyggda mått hamnar fel så fort admin
 * ändrat en maskin: rullbanan är tre meter i katalogen som följer med koden
 * och tolv i kundens, och då står nästa maskin mitt inne i den.
 */
export function templateConfig(
  templateId: string,
  library: MachineLibrary = BUILTIN_LIBRARY,
): Configuration {
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const config = base(`${template.name} — förstudie`, template.machineIds);
  Object.assign(config.hall, template.hall ?? {});
  Object.assign(config.flow, template.flow ?? {});
  // Startpunkten följer hallen och inmatningsriktningen om mallen ändrat dem.
  config.flow.startPoint = defaultStartPoint(config);

  /*
   * Mallen ritar in en hämtzon vid utlastningen och en port i gaveln, som
   * utgångspunkt. Båda är vanliga ritade objekt som kunden flyttar, ändrar
   * eller tar bort — truckgatan hänger inte ihop med linjens längd.
   */
  /*
   * Mallens maskiner läggs på rad och får sina positioner inskrivna.
   *
   * Positionen är kundens att ändra, så mallen måste ge varje maskin en
   * att börja från — annars står allt i origo. Raden räknas av layouten
   * själv, ur maskinernas verkliga mått, och skrivs sedan in i posterna.
   */
  const row = solveLayout(config, library);
  for (const placement of row.placements) {
    const item = config.line.find((i) => i.instanceId === placement.instanceId);
    if (item) item.pos = { ...placement.origin };
  }

  const solved = solveLayout(config, library);
  const suggestion = suggestTruckZone(solved.lineBounds, "x+", config.flow.truckPickupSide);
  config.drawn.push({
    id: "truck-1",
    kind: "truck",
    name: "Hämtzon utlastning",
    ...suggestion,
    h: 0,
  });
  config.drawn.push({
    id: "door-1",
    kind: "door",
    name: "Port A",
    x: config.hall.lengthMm - 300,
    y: Math.max(0, Math.min(config.hall.widthMm - 4500, suggestion.y + suggestion.w / 2 - 2250)),
    l: 300,
    w: 4500,
    h: 5000,
  });

  return config;
}

export function emptyConfig(): Configuration {
  return base("Ny anläggning", []);
}

export function defaultConfig(): Configuration {
  return templateConfig("strolinje");
}
