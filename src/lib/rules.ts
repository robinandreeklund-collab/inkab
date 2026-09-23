import { BUILTIN_LIBRARY, CATEGORY_ORDER, getMachine, type MachineLibrary } from "./library";
import { boxCenter, boxContains, boxesOverlap, overlapAreaMm2, segmentIntersectsBox, unionBox } from "./geometry";
import type { SolveOutput } from "./solver";
import type { Box, Configuration, Diagnostic, Placement } from "./types";

const m = (mm: number) => (mm / 1000).toFixed(1).replace(".", ",");

/** Tolerans för höjdskillnad mellan sammankopplade portar, mm. */
const PORT_LEVEL_TOLERANCE_MM = 20;
/** Maskiner får nudda varandra; överlapp under detta ignoreras, mm. */
const TOUCH_TOLERANCE_MM = 30;
/** Hur nära slutpunkten linjen måste sluta innan det räknas som avvikelse, mm. */
const END_POINT_TOLERANCE_MM = 500;
/** Minsta rimliga bredd på en truckgata, mm. */
const MIN_TRUCK_WIDTH_MM = 3500;
/** Hur nära en port truckgatan ska ligga för att räknas som ansluten, mm. */
const DOOR_REACH_MM = 1500;

/**
 * Zonen kapad vid maskinens egna ändar.
 *
 * En maskinzon är fritt utrymme, men inte lika åt alla håll: framåt och bakåt
 * är den kopplingsytan — där står nästa maskin i linjen, och det är så en
 * anläggning byggs. Åt sidorna är den åtkomst, och där är ett hinder ett
 * hinder. Katalogen säger samma sak i siffror: fram och bak är 600–1000 mm,
 * vänster och höger 1000–2200. Servicezonerna ligger uteslutande längs
 * långsidorna.
 *
 * Förut visste solvern vilka maskiner som satt ihop port mot port och undantog
 * dem. Med fri placering finns ingen kedja att fråga, och utan den blev varje
 * granne ett intrång: en helt vanlig linje gav åtta fel och fyra varningar.
 * Geometrin räcker för att skilja ändarna från sidorna.
 */
function sidesOnly(zone: Box, p: Placement): Box {
  const alongX = Math.abs(p.bbox.l - p.size.lengthMm) < Math.abs(p.bbox.w - p.size.lengthMm);
  if (alongX) {
    const x = Math.max(zone.x, p.bbox.x);
    return { x, y: zone.y, l: Math.max(0, Math.min(zone.x + zone.l, p.bbox.x + p.bbox.l) - x), w: zone.w };
  }
  const y = Math.max(zone.y, p.bbox.y);
  return { x: zone.x, y, l: zone.l, w: Math.max(0, Math.min(zone.y + zone.w, p.bbox.y + p.bbox.w) - y) };
}

function hallBox(config: Configuration): Box {
  return { x: 0, y: 0, l: config.hall.lengthMm, w: config.hall.widthMm };
}

/**
 * Regelverket. Varje regel är deterministisk och körs på solverns utdata —
 * ingen av dem är hårdkodad text, alla räknas fram ur geometrin.
 */
export function runRules(
  config: Configuration,
  layout: SolveOutput,
  library: MachineLibrary = BUILTIN_LIBRARY,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const line = layout.placements.filter((p) => !p.aux).sort((a, b) => a.pos - b.pos);
  const aux = layout.placements.filter((p) => p.aux);
  const all = layout.placements;
  const hall = hallBox(config);

  /* ── R-103 Maskiner överlappar ──────────────────────────────────────── */
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (!boxesOverlap(a.bbox, b.bbox, TOUCH_TOLERANCE_MM)) continue;
      const area = overlapAreaMm2(a.bbox, b.bbox) / 1e6;
      out.push({
        code: "R-103",
        severity: "error",
        title: "Maskiner överlappar",
        detail: `${a.machine.name} och ${b.machine.name} går in i varandra över ${area.toFixed(1).replace(".", ",")} m².`,
        instanceIds: [a.instanceId, b.instanceId],
        anchor: boxCenter(a.bbox),
      });
    }
  }

  /* ── R-104 Servicezon blockerad ─────────────────────────────────────── */
  for (const p of all) {
    for (const zone of p.zones.filter((z) => z.type === "service")) {
      const box = sidesOnly(zone.box, p);
      for (const other of all) {
        if (other.instanceId === p.instanceId) continue;
        if (!boxesOverlap(box, other.bbox, TOUCH_TOLERANCE_MM)) continue;
        out.push({
          code: "R-104",
          severity: "warning",
          title: "Servicezon blockerad",
          detail: `${other.machine.name} står i servicezonen för ${p.machine.name}. Underhåll blir svårt att komma åt.`,
          instanceIds: [p.instanceId, other.instanceId],
          anchor: boxCenter(box),
        });
      }
    }
  }

  /* ── R-106 Maskinzonen inkräktad ────────────────────────────────────── */
  for (const p of all) {
    const clearance = p.zones.find((z) => z.type === "clearance");
    if (!clearance) continue;
    const sides = sidesOnly(clearance.box, p);

    for (const other of all) {
      if (other.instanceId === p.instanceId) continue;
      if (!boxesOverlap(sides, other.bbox, TOUCH_TOLERANCE_MM)) continue;
      out.push({
        code: "R-106",
        severity: "error",
        title: "Maskinzonen är inkräktad",
        detail: `${other.machine.name} står innanför maskinzonen kring ${p.machine.name}. Det fria utrymmet runt maskinen måste hållas.`,
        instanceIds: [p.instanceId, other.instanceId],
        anchor: boxCenter(other.bbox),
      });
    }

    for (const obj of config.drawn) {
      if (obj.kind === "door" || obj.kind === "truck") continue;
      const box: Box = { x: obj.x, y: obj.y, l: obj.l, w: obj.w };
      if (!boxesOverlap(sides, box, TOUCH_TOLERANCE_MM)) continue;
      out.push({
        code: "R-106",
        severity: "error",
        title: "Maskinzonen är inkräktad",
        detail: `${obj.name} går in i maskinzonen kring ${p.machine.name}.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(box),
      });
    }
  }

  /* ── R-105 Skyddszon skär truckgatan ────────────────────────────────── */
  for (const aisle of layout.aisles) {
    for (const p of all) {
      for (const zone of p.zones.filter((z) => z.type === "safety")) {
        if (!boxesOverlap(zone.box, aisle.box, TOUCH_TOLERANCE_MM)) continue;
        out.push({
          code: "R-105",
          severity: "error",
          title: "Skyddszon ligger i truckgatan",
          detail: `Skyddszonen kring ${p.machine.name} skär ${aisle.label.toLowerCase()}. Trucken kan inte passera en aktiv skyddszon.`,
          instanceIds: [p.instanceId],
          anchor: boxCenter(zone.box),
        });
      }
    }
  }

  /* ── R-201 Truckgatan får inte plats ────────────────────────────────── */
  for (const aisle of layout.aisles) {
    if (!boxContains(hall, aisle.box, 1)) {
      out.push({
        code: "R-201",
        severity: "error",
        title: "Truckgatan ligger utanför hallen",
        detail: `${aisle.label} sträcker sig utanför hallens ${m(config.hall.lengthMm)} × ${m(config.hall.widthMm)} m.`,
        instanceIds: [],
        anchor: boxCenter(aisle.box),
      });
    }
    if (aisle.widthMm < MIN_TRUCK_WIDTH_MM) {
      out.push({
        code: "R-201",
        severity: "warning",
        title: "Truckgatan är smal",
        detail: `${aisle.label} är ${m(aisle.widthMm)} m på sitt smalaste ställe. En motviktstruck med paket behöver normalt minst ${m(MIN_TRUCK_WIDTH_MM)} m.`,
        instanceIds: [],
        anchor: boxCenter(aisle.box),
      });
    }
  }

  /* ── R-205 Ingen truckgata ritad ────────────────────────────────────── */
  if (layout.aisles.length === 0 && line.length > 0) {
    out.push({
      code: "R-205",
      severity: "warning",
      title: "Ingen truckgata eller hämtzon",
      detail:
        "Rita ut var trucken kör och hämtar färdiga paket. Utan den kan varken utrymme eller åtkomst kontrolleras.",
      instanceIds: [],
      anchor: boxCenter(layout.lineBounds),
    });
  }

  /* ── R-203 Hjälpobjekt står i truckgatan ────────────────────────────── */
  for (const aisle of layout.aisles) {
    for (const p of aux) {
      if (!boxesOverlap(p.bbox, aisle.box, TOUCH_TOLERANCE_MM)) continue;
      out.push({
        code: "R-203",
        severity: "error",
        title: `${p.machine.name} står i truckgatan`,
        detail: `${p.machine.name} står i ${aisle.label.toLowerCase()}. Trucken kan inte passera.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(p.bbox),
      });
    }
  }

  /* ── R-204 Magasinet nås inte utan att passera maskinerna ───────────── */
  const magazine = aux.find((p) => p.machine.category === "stickers" && p.aux);
  if (magazine && layout.aisles.length > 0 && line.length > 0) {
    // Närmaste truckzon är den trucken realistiskt kör från.
    const magazineCenter = boxCenter(magazine.bbox);
    const nearest = layout.aisles.reduce((best, a) => {
      const c = boxCenter(a.box);
      const d = Math.hypot(c.x - magazineCenter.x, c.y - magazineCenter.y);
      const bc = boxCenter(best.box);
      return d < Math.hypot(bc.x - magazineCenter.x, bc.y - magazineCenter.y) ? a : best;
    });
    const from = boxCenter(nearest.box);
    const to = boxCenter(magazine.bbox);
    const blocking = line.filter((p) => segmentIntersectsBox(from, to, p.bbox));
    if (blocking.length > 0) {
      out.push({
        code: "R-204",
        severity: "warning",
        title: "Magasinet nås inte utan att passera maskinerna",
        detail: `Trucken måste passera ${blocking.map((b) => b.machine.name).join(", ")} för att fylla ${magazine.machine.name}.`,
        instanceIds: [magazine.instanceId, ...blocking.map((b) => b.instanceId)],
        anchor: boxCenter(magazine.bbox),
      });
    }
  }

  /* ── R-207 Truckgatan når ingen port ────────────────────────────────── */
  const doors = config.drawn.filter((d) => d.kind === "door");
  if (doors.length > 0 && layout.aisles.length > 0) {
    for (const aisle of layout.aisles) {
      const reaches = doors.some((door) =>
        boxesOverlap(aisle.box, { x: door.x, y: door.y, l: door.l, w: door.w }, -DOOR_REACH_MM),
      );
      if (reaches) continue;
      out.push({
        code: "R-207",
        severity: "warning",
        title: "Truckgatan når ingen port",
        detail: `${aisle.label} ansluter inte till någon av hallens portar. Kontrollera hur trucken tar sig in och ut.`,
        instanceIds: [],
        anchor: boxCenter(aisle.box),
      });
    }
  }

  /* ── R-301 Kapacitet under målet ────────────────────────────────────── */
  for (const p of line) {
    if (p.capacity <= 0) continue;
    if (p.capacity >= config.product.targetPackagesPerHour) continue;
    out.push({
      code: "R-301",
      severity: "warning",
      title: "Kapaciteten understiger målet",
      detail: `${p.machine.name} klarar ${p.capacity} paket/h men linjen är dimensionerad för ${config.product.targetPackagesPerHour} paket/h.`,
      instanceIds: [p.instanceId],
      anchor: boxCenter(p.bbox),
    });
  }

  /* ── R-302 / R-303 Produkten utanför maskinens intervall ────────────── */
  const prod = config.product;
  for (const p of line) {
    const c = p.machine.capacity;
    if (c.maxWeightKg <= 0) continue;
    const checks: [string, number, [number, number]][] = [
      ["längd", prod.packageLengthMm, c.packageLengthMm],
      ["minsta virkesbredd", prod.packageWidthMinMm, c.packageWidthMm],
      ["största virkesbredd", prod.packageWidthMaxMm, c.packageWidthMm],
      ["höjd", prod.packageHeightMm, c.packageHeightMm],
    ];
    for (const [label, value, [min, max]] of checks) {
      if (value >= min && value <= max) continue;
      out.push({
        code: "R-302",
        severity: "error",
        title: "Paketet passar inte maskinen",
        detail: `Paketets ${label} ${m(value)} m ligger utanför ${p.machine.name}: ${m(min)}–${m(max)} m.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(p.bbox),
      });
    }

    // Portarna måste rymma hela virkesbreddsintervallet, inte bara ett värde.
    for (const port of p.ports) {
      const [portMin, portMax] = p.machine.ports.find((x) => x.id === port.id)?.widthMm ?? [0, 0];
      if (portMax <= 0) continue;
      if (prod.packageWidthMinMm >= portMin && prod.packageWidthMaxMm <= portMax) continue;
      out.push({
        code: "R-304",
        severity: "warning",
        title: "Porten täcker inte hela virkesbreddsintervallet",
        detail: `Port ${port.id} på ${p.machine.name} tar ${m(portMin)}–${m(portMax)} m, men linjen ska köra ${m(prod.packageWidthMinMm)}–${m(prod.packageWidthMaxMm)} m.`,
        instanceIds: [p.instanceId],
        anchor: port.pos,
      });
    }
    if (prod.packageWeightKg > c.maxWeightKg) {
      out.push({
        code: "R-303",
        severity: "error",
        title: "Paketet är för tungt",
        detail: `${prod.packageWeightKg} kg överstiger ${p.machine.name}s max ${c.maxWeightKg} kg.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(p.bbox),
      });
    }
  }

  /* ── R-401 / R-402 Hallens gränser ──────────────────────────────────── */
  for (const p of all) {
    if (boxContains(hall, p.bbox, 1)) continue;
    out.push({
      code: "R-401",
      severity: "error",
      title: "Maskinen hamnar utanför hallen",
      detail: `${p.machine.name} ligger utanför hallens ${m(config.hall.lengthMm)} × ${m(config.hall.widthMm)} m.`,
      instanceIds: [p.instanceId],
      anchor: boxCenter(p.bbox),
    });
  }
  for (const p of all) {
    if (p.size.heightMm <= config.hall.clearHeightMm) continue;
    out.push({
      code: "R-402",
      severity: "error",
      title: "Maskinen är högre än hallen",
      detail: `${p.machine.name} är ${m(p.size.heightMm)} m hög, fri höjd är ${m(config.hall.clearHeightMm)} m.`,
      instanceIds: [p.instanceId],
      anchor: boxCenter(p.bbox),
    });
  }

  /* ── R-403 Kollision med ritad vägg eller no-go-zon ─────────────────── */
  for (const p of all) {
    for (const obj of config.drawn) {
      // Portar är öppningar och truckzoner hanteras av R-203; varken eller
      // är ett hinder som maskinen kan "krocka" med.
      if (obj.kind === "door" || obj.kind === "truck") continue;
      const box: Box = { x: obj.x, y: obj.y, l: obj.l, w: obj.w };
      if (!boxesOverlap(p.bbox, box, TOUCH_TOLERANCE_MM)) continue;
      out.push({
        code: "R-403",
        severity: "error",
        title: obj.kind === "wall" ? "Maskinen krockar med en vägg" : "Maskinen står i en no-go-zon",
        detail: `${p.machine.name} överlappar ${obj.name}.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(p.bbox),
      });
    }
  }

  /* ── R-404 Maskin i truckgatan ──────────────────────────────────────── */
  for (const aisle of layout.aisles) {
    for (const p of line) {
      if (!boxesOverlap(p.bbox, aisle.box, TOUCH_TOLERANCE_MM)) continue;
      out.push({
        code: "R-404",
        severity: "error",
        title: "Maskinen står i truckgatan",
        detail: `${p.machine.name} ligger i ${aisle.label.toLowerCase()}. Flytta maskinen eller rita om zonen.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(p.bbox),
      });
    }
  }

  /* ── R-501 Beroenden och konflikter ─────────────────────────────────── */
  const presentIds = new Set(layout.placements.map((p) => p.machineId));
  for (const p of layout.placements) {
    for (const req of p.machine.requires ?? []) {
      if (presentIds.has(req)) continue;
      const reqMachine = getMachine(req, library);
      out.push({
        code: "R-501",
        severity: "error",
        title: "Maskin saknas i linjen",
        detail: `${p.machine.name} kräver ${reqMachine?.name ?? req} för att fungera.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(p.bbox),
        fix: { kind: "addMachine", machineId: req, label: `Lägg till ${reqMachine?.name ?? req}` },
      });
    }
    for (const conflict of p.machine.conflictsWith ?? []) {
      if (!presentIds.has(conflict)) continue;
      out.push({
        code: "R-501",
        severity: "error",
        title: "Maskinerna kan inte kombineras",
        detail: `${p.machine.name} kan inte kombineras med ${getMachine(conflict, library)?.name ?? conflict}.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(p.bbox),
      });
    }
  }

  /* ── R-107 Maskinen finns inte i biblioteket ────────────────────────── */
  for (const u of layout.unplaced) {
    out.push({
      code: "R-107",
      severity: "error",
      title: "Maskinen finns inte i biblioteket",
      detail: `${getMachine(u.machineId, library)?.name ?? u.machineId}: ${u.reason}`,
      instanceIds: [u.instanceId],
    });
  }

  return dedupe(out);
}

/** Samma regel på samma maskinpar rapporteras en gång. */
function dedupe(list: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const order = { error: 0, warning: 1, info: 2 } as const;
  return list
    .filter((d) => {
      const key = `${d.code}|${[...d.instanceIds].sort().join(",")}|${d.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
}

export function boundsOfAll(placements: Placement[]): Box {
  return unionBox(placements.map((p) => p.bbox));
}
