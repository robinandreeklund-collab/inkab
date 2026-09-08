import { defaultStartPoint } from "./solver";
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
  infeedFrom: "straight",
  controlDeskSide: "right",
  stickerMagazineSide: "right",
  truckPickupSide: "left",
  finalConveyorLengthMm: 12000,
  startPoint: { x: 2000, y: Math.round(DEFAULT_HALL.widthMm / 2) },
  endPoint: null,
  fitToEndPoint: false,
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

export function templateConfig(templateId: string): Configuration {
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const config = base(`${template.name} — förstudie`, template.machineIds);
  Object.assign(config.hall, template.hall ?? {});
  Object.assign(config.flow, template.flow ?? {});
  // Startpunkten följer hallen och inmatningsriktningen om mallen ändrat dem.
  config.flow.startPoint = defaultStartPoint(config);
  return config;
}

export function emptyConfig(): Configuration {
  return base("Ny anläggning", []);
}

export function defaultConfig(): Configuration {
  return templateConfig("strolinje");
}
