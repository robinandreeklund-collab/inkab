import { BUILTIN_LIBRARY, CATEGORY_ORDER, getMachine, type MachineLibrary } from "./library";
import { boxCenter, boxContains, boxesOverlap, overlapAreaMm2, segmentIntersectsBox, unionBox } from "./geometry";
import type { SolveOutput } from "./solver";
import type { Box, Configuration, Diagnostic, Placement } from "./types";
import { translate } from "./i18n/translate";

/** Textslagning på kundens språk. Se lib/i18n. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

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
  /*
   * Texterna kommer utifrån, på kundens språk. Regeln räknar, den formulerar
   * inte: en tysk kund ska inte läsa svenska fel om sin egen anläggning.
   * Utan översättare svarar regelverket på svenska, som förut.
   */
  t: Translate = (key, vars) => translate("sv", key, vars),
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
        title: t("rule.overlap.t"),
        detail: t("rule.overlap.d", {
          a: a.machine.name,
          b: b.machine.name,
          area: area.toFixed(1).replace(".", ","),
        }),
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
          title: t("rule.service.t"),
          detail: t("rule.service.d", { other: other.machine.name, machine: p.machine.name }),
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
        title: t("rule.clearance.t"),
        detail: t("rule.clearance.d", { other: other.machine.name, machine: p.machine.name }),
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
        title: t("rule.clearance.t"),
        detail: t("rule.clearanceObj.d", { obj: obj.name, machine: p.machine.name }),
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
          title: t("rule.safety.t"),
          detail: t("rule.safety.d", { machine: p.machine.name, aisle: aisle.label.toLowerCase() }),
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
        title: t("rule.aisleOut.t"),
        detail: t("rule.aisleOut.d", {
          aisle: aisle.label,
          l: m(config.hall.lengthMm),
          w: m(config.hall.widthMm),
        }),
        instanceIds: [],
        anchor: boxCenter(aisle.box),
      });
    }
    if (aisle.widthMm < MIN_TRUCK_WIDTH_MM) {
      out.push({
        code: "R-201",
        severity: "warning",
        title: t("rule.aisleNarrow.t"),
        detail: t("rule.aisleNarrow.d", {
          aisle: aisle.label,
          w: m(aisle.widthMm),
          min: m(MIN_TRUCK_WIDTH_MM),
        }),
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
      title: t("rule.noAisle.t"),
      detail: t("rule.noAisle.d"),
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
        title: t("rule.auxAisle.t", { machine: p.machine.name }),
        detail: t("rule.auxAisle.d", { machine: p.machine.name, aisle: aisle.label.toLowerCase() }),
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
        title: t("rule.magazine.t"),
        detail: t("rule.magazine.d", {
          blocking: blocking.map((b) => b.machine.name).join(", "),
          magazine: magazine.machine.name,
        }),
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
        title: t("rule.aisleDoor.t"),
        detail: t("rule.aisleDoor.d", { aisle: aisle.label }),
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
      title: t("rule.capacity.t"),
      detail: t("rule.capacity.d", {
        machine: p.machine.name,
        has: p.capacity,
        target: config.product.targetPackagesPerHour,
      }),
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
      ["product.length", prod.packageLengthMm, c.packageLengthMm],
      ["sidebar.widthMin", prod.packageWidthMinMm, c.packageWidthMm],
      ["sidebar.widthMax", prod.packageWidthMaxMm, c.packageWidthMm],
      ["product.height", prod.packageHeightMm, c.packageHeightMm],
    ];
    for (const [label, value, [min, max]] of checks) {
      if (value >= min && value <= max) continue;
      out.push({
        code: "R-302",
        severity: "error",
        title: t("rule.package.t"),
        detail: t("rule.package.d", {
          label: t(label).toLowerCase(),
          value: m(value),
          machine: p.machine.name,
          min: m(min),
          max: m(max),
        }),
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
        title: t("rule.portWidth.t"),
        detail: t("rule.portWidth.d", {
          port: port.id,
          machine: p.machine.name,
          portMin: m(portMin),
          portMax: m(portMax),
          prodMin: m(prod.packageWidthMinMm),
          prodMax: m(prod.packageWidthMaxMm),
        }),
        instanceIds: [p.instanceId],
        anchor: port.pos,
      });
    }
    if (prod.packageWeightKg > c.maxWeightKg) {
      out.push({
        code: "R-303",
        severity: "error",
        title: t("rule.weight.t"),
        detail: t("rule.weight.d", {
          kg: prod.packageWeightKg,
          machine: p.machine.name,
          max: c.maxWeightKg,
        }),
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
      title: t("rule.outsideHall.t"),
      detail: t("rule.outsideHall.d", {
        machine: p.machine.name,
        l: m(config.hall.lengthMm),
        w: m(config.hall.widthMm),
      }),
      instanceIds: [p.instanceId],
      anchor: boxCenter(p.bbox),
    });
  }
  for (const p of all) {
    if (p.size.heightMm <= config.hall.clearHeightMm) continue;
    out.push({
      code: "R-402",
      severity: "error",
      title: t("rule.tooTall.t"),
      detail: t("rule.tooTall.d", {
        machine: p.machine.name,
        h: m(p.size.heightMm),
        clear: m(config.hall.clearHeightMm),
      }),
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
        title: obj.kind === "wall" ? t("rule.hitWall.t") : t("rule.hitNogo.t"),
        detail: t("rule.hitObj.d", { machine: p.machine.name, obj: obj.name }),
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
        title: t("rule.inAisle.t"),
        detail: t("rule.inAisle.d", { machine: p.machine.name, aisle: aisle.label.toLowerCase() }),
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
        title: t("rule.requires.t"),
        detail: t("rule.requires.d", { machine: p.machine.name, needs: reqMachine?.name ?? req }),
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
        title: t("rule.conflict.t"),
        detail: t("rule.conflict.d", {
          machine: p.machine.name,
          other: getMachine(conflict, library)?.name ?? conflict,
        }),
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
      title: t("rule.unknown.t"),
      detail: t("rule.unknown.d", {
        machine: getMachine(u.machineId, library)?.name ?? u.machineId,
        reason: t("rule.reasonMissing"),
      }),
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
