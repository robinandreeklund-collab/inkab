import type { Configuration, Flow, Hall, LineItem } from "./types";

let counter = 0;
export function newInstanceId(machineId: string): string {
  counter += 1;
  return `${machineId}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function lineItem(machineId: string, selectedOptions: string[] = []): LineItem {
  return { instanceId: newInstanceId(machineId), machineId, selectedOptions };
}

export const DEFAULT_HALL: Hall = { lengthMm: 46000, widthMm: 22500, clearHeightMm: 6000 };

export const DEFAULT_PRODUCT = {
  packageLengthMm: 4800,
  packageWidthMm: 1200,
  packageHeightMm: 1100,
  packageWeightKg: 1800,
  targetPackagesPerHour: 20,
};

export const DEFAULT_FLOW: Flow = {
  infeedFrom: "straight",
  controlDeskSide: "right",
  stickerMagazineSide: "right",
  truckPickupSide: "left",
  finalConveyorLengthMm: 12000,
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
    name: "Ströläggningslinje",
    description: "Inmatning, truckströläggare med ströretur och magasin, buffert till utlastning.",
    machineIds: ["ib2", "ts4", "sr2", "kt", "ub1", "mp1", "sf3"],
  },
  {
    id: "paketlinje",
    name: "Paketlinje med press och bandning",
    description: "Paketläggning, press och omsnörning före utlastning.",
    machineIds: ["ib2", "pl3", "pp1", "bm2", "kt", "ub1", "mp1"],
  },
  {
    id: "komplett",
    name: "Komplett pakethantering",
    description: "Full linje med ströläggning, kap, press, bandning och utlastning.",
    machineIds: ["ib2", "pl3", "ts4", "sr2", "pk1", "pp1", "bm2", "kt", "ub1", "mp1", "sf3"],
    // Nio maskiner i följd blir cirka 57 m — kräver en längre hall.
    hall: { lengthMm: 66000, widthMm: 28000 },
  },
  {
    id: "vinklad",
    name: "Vinklad inmatning",
    description: "Paketen kommer in från sidan och vinklas med tvärtransportör.",
    machineIds: ["ib2", "tt1", "ts4", "sr2", "kt", "ub1", "mp1", "sf3"],
    flow: { infeedFrom: "right" },
  },
];

export function templateConfig(templateId: string): Configuration {
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const config = base(`${template.name} — förstudie`, template.machineIds);
  Object.assign(config.hall, template.hall ?? {});
  Object.assign(config.flow, template.flow ?? {});
  return config;
}

export function emptyConfig(): Configuration {
  return base("Ny anläggning", []);
}

export function defaultConfig(): Configuration {
  return templateConfig("strolinje");
}
