/**
 * Maskinernas underlag.
 *
 * En maskin i katalogen är inte bara mått och pris. Bakom den ligger ritningar,
 * en STEP-modell, en balklista, skärfiler som måste beställas hos en
 * legotillverkare, elscheman och monteringsanvisningar. I dag ligger de i
 * mappar på olika datorer, och den som ska bygga maskinen får leta.
 *
 * Här hör de till maskinen. Vilken sort filen är, vilken revision den har, och
 * — för det som måste beställas — var i beställningen den står.
 */

export type DocumentKind =
  | "drawing"
  | "step"
  | "cad"
  | "beamlist"
  | "cutting"
  | "electrical"
  | "manual"
  | "other";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  drawing: "Ritning",
  step: "STEP-modell",
  cad: "CAD-fil",
  beamlist: "Balklista",
  cutting: "Skärfil",
  electrical: "Elschema",
  manual: "Anvisning",
  other: "Övrigt",
};

/**
 * Var en beställd fil står.
 *
 * Skärfiler går till legotillverkning och är inte klara för att de finns i
 * systemet. Att veta skillnaden mellan "ska beställas" och "ligger hos
 * leverantören" är skillnaden mellan en plan och en gissning.
 */
export type OrderState = "none" | "needed" | "ordered" | "received";

export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  none: "Ingen beställning",
  needed: "Ska beställas",
  ordered: "Beställd",
  received: "Levererad",
};

/** Sorter som normalt beställs hos någon annan. */
export const ORDERED_KINDS: DocumentKind[] = ["cutting", "beamlist"];

export type MachineDocument = {
  id: string;
  machineId: string;
  kind: DocumentKind;
  /** Filnamnet som det laddades upp. */
  name: string;
  /** Vad filen är, med INKAB:s ord. */
  title: string;
  mime: string;
  revision: string;
  note: string;
  orderState: OrderState;
  supplier: string;
  bytes: number;
  uploadedBy: string;
  createdAt: string;
};

/** 25 MB. En STEP-fil på en hel linje ligger på några megabyte. */
export const MAX_DOCUMENT_BYTES = 25_000_000;

export function isDocumentKind(value: string): value is DocumentKind {
  return value in DOCUMENT_KIND_LABEL;
}

export function isOrderState(value: string): value is OrderState {
  return value in ORDER_STATE_LABEL;
}

/** Gissar sorten ur filnamnet, som ett förval den som laddar upp kan ändra. */
export function guessKind(fileName: string): DocumentKind {
  const name = fileName.toLowerCase();
  const extension = name.split(".").pop() ?? "";

  if (["step", "stp"].includes(extension)) return "step";
  if (["dwg", "dxf", "iges", "igs", "sldprt", "sldasm", "ipt", "iam"].includes(extension)) {
    return "cad";
  }
  if (name.includes("balk")) return "beamlist";
  if (name.includes("skär") || name.includes("skar") || name.includes("laser")) return "cutting";
  if (name.includes("el-") || name.includes("elschema") || name.includes("schema")) {
    return "electrical";
  }
  if (name.includes("anvisning") || name.includes("manual")) return "manual";
  if (["pdf", "png", "jpg", "jpeg", "tif", "tiff"].includes(extension)) return "drawing";
  return "other";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
  return `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB`;
}
