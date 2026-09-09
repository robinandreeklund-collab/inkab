import { meters } from "./format";
import type { Box, Configuration, LayoutResult } from "./types";
import type { PriceResult, Role } from "./server/pricing";

/**
 * Export av underlaget.
 *
 * Två format som kunden faktiskt kan använda: maskinlistan som CSV till Excel,
 * och planritningen som DXF till kundens eget layoutarbete. Båda genereras i
 * webbläsaren ur samma data som skärmen visar — det finns ingen andra sanning
 * att hålla synkroniserad.
 */

/* ── CSV ───────────────────────────────────────────────────────────────── */

/** Escapar enligt RFC 4180: citattecken dubbleras, fältet citeras alltid. */
function cell(value: string | number): string {
  // Decimalpunkt blir komma: svensk Excel läser annars talet som text.
  const text = typeof value === "number" ? String(value).replace(".", ",") : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function machineListCsv(
  config: Configuration,
  layout: LayoutResult,
  price: PriceResult | null,
  role: Role,
): string {
  const showPrice = role !== "guest";
  const header = [
    "Pos",
    "Benämning",
    "Artikel",
    "Optioner",
    "Antal",
    "Längd (m)",
    "Bredd (m)",
    "Höjd (m)",
    "Effekt (kW)",
    ...(showPrice ? ["Radpris (kr)"] : []),
  ];

  const byInstance = new Map(layout.placements.map((p) => [p.instanceId, p]));
  const rows = (price?.lines ?? []).map((line) => {
    const placement = byInstance.get(line.instanceId);
    return [
      line.pos,
      line.name,
      line.sku,
      line.optionNames.join(", "),
      line.quantity,
      placement ? meters(placement.size.lengthMm, 2) : "",
      placement ? meters(placement.size.widthMm, 2) : "",
      placement ? meters(placement.size.heightMm, 2) : "",
      placement ? placement.powerKw : "",
      ...(showPrice ? [line.rowTotal ?? ""] : []),
    ];
  });

  const summary = [
    [],
    ["Projekt", config.projectName],
    ["Totalmått (m)", `${meters(layout.metrics.totalLengthMm)} × ${meters(layout.metrics.totalWidthMm)}`],
    ["Golvyta (m²)", layout.metrics.footprintM2],
    ["Kapacitet (pkt/h)", layout.metrics.throughputPerHour],
    ["Effekt (kW)", layout.metrics.totalPowerKw],
    ["Leveranstid (veckor)", layout.metrics.leadTimeWeeks],
    ["Tillverkning (h)", layout.metrics.manufacturingHours],
    ["Montage (h)", layout.metrics.assemblyHours],
  ];

  // Semikolon och BOM: svensk Excel läser komma som decimaltecken och
  // öppnar annars filen i fel teckenkodning.
  return (
    "﻿" +
    [header, ...rows, ...summary].map((row) => row.map(cell).join(";")).join("\r\n") +
    "\r\n"
  );
}

/* ── DXF ───────────────────────────────────────────────────────────────── */

type DxfEntity = string[];

function pair(code: number, value: string | number): string[] {
  return [String(code), String(value)];
}

/** Världens Y pekar nedåt i planvyn, DXF:ens uppåt. */
const flip = (y: number) => -y;

function line(layer: string, x1: number, y1: number, x2: number, y2: number): DxfEntity {
  return [
    ...pair(0, "LINE"),
    ...pair(8, layer),
    ...pair(10, x1.toFixed(1)),
    ...pair(20, flip(y1).toFixed(1)),
    ...pair(30, 0),
    ...pair(11, x2.toFixed(1)),
    ...pair(21, flip(y2).toFixed(1)),
    ...pair(31, 0),
  ];
}

function rect(layer: string, box: Box): DxfEntity {
  const { x, y, l, w } = box;
  return [
    ...line(layer, x, y, x + l, y),
    ...line(layer, x + l, y, x + l, y + w),
    ...line(layer, x + l, y + w, x, y + w),
    ...line(layer, x, y + w, x, y),
  ];
}

function label(layer: string, x: number, y: number, height: number, value: string): DxfEntity {
  return [
    ...pair(0, "TEXT"),
    ...pair(8, layer),
    ...pair(10, x.toFixed(1)),
    ...pair(20, flip(y).toFixed(1)),
    ...pair(30, 0),
    ...pair(40, height.toFixed(1)),
    ...pair(1, value.replace(/\n/g, " ")),
    // Centrerad text kräver både justeringskod och andra insättningspunkten.
    ...pair(72, 1),
    ...pair(11, x.toFixed(1)),
    ...pair(21, flip(y).toFixed(1)),
    ...pair(31, 0),
  ];
}

const LAYERS = [
  ["HALL", 7],
  ["MASKIN", 5],
  ["MASKINZON", 8],
  ["TRUCKGATA", 3],
  ["SPARRAD", 1],
  ["VAGG", 7],
  ["PORT", 4],
  ["TEXT", 7],
  ["FLODE", 2],
] as const;

/**
 * DXF R12 i ASCII. Det äldsta formatet, och därför det som öppnas av allt —
 * AutoCAD, BricsCAD, SolidWorks, LibreCAD, QCAD. Enheten är millimeter.
 */
export function planDxf(config: Configuration, layout: LayoutResult): string {
  const out: string[] = [];

  out.push(
    ...pair(0, "SECTION"),
    ...pair(2, "HEADER"),
    ...pair(9, "$INSUNITS"),
    ...pair(70, 4), // millimeter
    ...pair(9, "$EXTMIN"),
    ...pair(10, 0),
    ...pair(20, flip(config.hall.widthMm)),
    ...pair(30, 0),
    ...pair(9, "$EXTMAX"),
    ...pair(10, config.hall.lengthMm),
    ...pair(20, 0),
    ...pair(30, 0),
    ...pair(0, "ENDSEC"),
  );

  out.push(...pair(0, "SECTION"), ...pair(2, "TABLES"), ...pair(0, "TABLE"), ...pair(2, "LAYER"), ...pair(70, LAYERS.length));
  for (const [name, color] of LAYERS) {
    out.push(...pair(0, "LAYER"), ...pair(2, name), ...pair(70, 0), ...pair(62, color), ...pair(6, "CONTINUOUS"));
  }
  out.push(...pair(0, "ENDTAB"), ...pair(0, "ENDSEC"));

  out.push(...pair(0, "SECTION"), ...pair(2, "ENTITIES"));

  out.push(...rect("HALL", { x: 0, y: 0, l: config.hall.lengthMm, w: config.hall.widthMm }));

  for (const d of config.drawn) {
    const layer =
      d.kind === "wall" ? "VAGG" : d.kind === "door" ? "PORT" : d.kind === "truck" ? "TRUCKGATA" : "SPARRAD";
    const box = { x: d.x, y: d.y, l: d.l, w: d.w };
    out.push(...rect(layer, box));
    if (d.name) out.push(...label("TEXT", d.x + d.l / 2, d.y + d.w / 2, 300, d.name));
  }

  for (const p of layout.placements) {
    out.push(...rect("MASKIN", p.bbox));
    for (const zone of p.zones) {
      if (zone.type === "clearance") out.push(...rect("MASKINZON", zone.box));
    }
    out.push(
      ...label(
        "TEXT",
        p.bbox.x + p.bbox.l / 2,
        p.bbox.y + p.bbox.w / 2,
        400,
        p.aux ? p.machine.name : `${p.pos}. ${p.machine.name}`,
      ),
    );
  }

  const chain = layout.placements.filter((p) => !p.aux);
  const points = [
    config.flow.startPoint,
    ...chain.map((p) => ({ x: p.bbox.x + p.bbox.l / 2, y: p.bbox.y + p.bbox.w / 2 })),
    ...(config.flow.endPoint ? [config.flow.endPoint] : []),
  ];
  for (let i = 1; i < points.length; i++) {
    out.push(...line("FLODE", points[i - 1].x, points[i - 1].y, points[i].x, points[i].y));
  }

  out.push(...pair(0, "ENDSEC"), ...pair(0, "EOF"));
  return out.join("\r\n") + "\r\n";
}

/* ── Nedladdning ───────────────────────────────────────────────────────── */

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Objektadressen frigörs efter att klicket hunnit starta nedladdningen.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Filnamn utan mellanslag och specialtecken, med underlagsnumret först. */
export function exportName(reference: string, projectName: string, extension: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${reference}${slug ? `-${slug}` : ""}.${extension}`;
}
