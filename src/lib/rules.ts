import { BUILTIN_LIBRARY, CATEGORY_ORDER, getMachine, type MachineLibrary } from "./library";
import { boxCenter, boxContains, boxesOverlap, overlapAreaMm2, segmentIntersectsBox, unionBox } from "./geometry";
import { TRUCK_AISLE_MM, type SolveOutput } from "./solver";
import type { Box, Configuration, Diagnostic, Placement } from "./types";

const m = (mm: number) => (mm / 1000).toFixed(1).replace(".", ",");

/** Tolerans för höjdskillnad mellan sammankopplade portar, mm. */
const PORT_LEVEL_TOLERANCE_MM = 20;
/** Maskiner får nudda varandra; överlapp under detta ignoreras, mm. */
const TOUCH_TOLERANCE_MM = 30;
/** Hur nära slutpunkten linjen måste sluta innan det räknas som avvikelse, mm. */
const END_POINT_TOLERANCE_MM = 500;

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

  /* ── R-101 Portmatchning ────────────────────────────────────────────── */
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const outPort = a.ports.find((p) => p.role === "out");
    const inPort = b.ports.find((p) => p.role === "in");
    if (!outPort || !inPort) continue;

    if (Math.abs(outPort.levelMm - inPort.levelMm) > PORT_LEVEL_TOLERANCE_MM) {
      out.push({
        code: "R-101",
        severity: "error",
        title: "Portarna ligger på olika höjd",
        detail: `${a.machine.name} lämnar paketet på ${outPort.levelMm} mm och ${b.machine.name} tar emot på ${inPort.levelMm} mm. Skillnaden är ${Math.abs(outPort.levelMm - inPort.levelMm)} mm.`,
        instanceIds: [a.instanceId, b.instanceId],
        anchor: outPort.pos,
      });
    }

    const gap = Math.hypot(outPort.pos.x - inPort.pos.x, outPort.pos.y - inPort.pos.y);
    if (gap > 50) {
      out.push({
        code: "R-101",
        severity: "warning",
        title: "Glapp mellan maskinerna",
        detail: `Det är ${m(gap)} m mellan ${a.machine.name} och ${b.machine.name}. En manuell förskjutning har brutit kopplingen.`,
        instanceIds: [a.instanceId, b.instanceId],
        anchor: outPort.pos,
      });
    }
  }

  /* ── R-102 Riktningsändring saknas ──────────────────────────────────── */
  if (layout.neverTurnedToMainAxis && line.length > 0) {
    out.push({
      code: "R-102",
      severity: "error",
      title: "Linjen vänds aldrig längs hallen",
      detail:
        "Paketen kommer in från sidan men ingen maskin i linjen kan vinkla flödet. Lägg till en tvärtransportör efter inmatningen.",
      instanceIds: [line[0].instanceId],
      anchor: boxCenter(line[0].bbox),
      fix: { kind: "addMachine", machineId: "tt1", label: "Lägg till tvärtransportör" },
    });
  }

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
      for (const other of all) {
        if (other.instanceId === p.instanceId) continue;
        if (!boxesOverlap(zone.box, other.bbox, TOUCH_TOLERANCE_MM)) continue;
        out.push({
          code: "R-104",
          severity: "warning",
          title: "Servicezon blockerad",
          detail: `${other.machine.name} står i servicezonen för ${p.machine.name}. Underhåll blir svårt att komma åt.`,
          instanceIds: [p.instanceId, other.instanceId],
          anchor: boxCenter(zone.box),
        });
      }
    }
  }

  /* ── R-106 Maskinzonen inkräktad ────────────────────────────────────── */
  for (const p of all) {
    const clearance = p.zones.find((z) => z.type === "clearance");
    if (!clearance) continue;

    for (const other of all) {
      if (other.instanceId === p.instanceId) continue;
      // Grannen i kedjan är inkopplad port mot port och står med rätta i
      // frigången framåt respektive bakåt. Zonen gäller allt annat.
      if (!p.aux && !other.aux && Math.abs(p.pos - other.pos) === 1) continue;
      if (!boxesOverlap(clearance.box, other.bbox, TOUCH_TOLERANCE_MM)) continue;
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
      const box: Box = { x: obj.x, y: obj.y, l: obj.l, w: obj.w };
      if (!boxesOverlap(clearance.box, box, TOUCH_TOLERANCE_MM)) continue;
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
  if (layout.aisle) {
    for (const p of all) {
      for (const zone of p.zones.filter((z) => z.type === "safety")) {
        if (!boxesOverlap(zone.box, layout.aisle.box, TOUCH_TOLERANCE_MM)) continue;
        out.push({
          code: "R-105",
          severity: "error",
          title: "Skyddszon ligger i truckgatan",
          detail: `Skyddszonen kring ${p.machine.name} skär truckgatan. Trucken kan inte passera en aktiv skyddszon.`,
          instanceIds: [p.instanceId],
          anchor: boxCenter(zone.box),
          fix: {
            kind: "flow",
            patch: { truckPickupSide: config.flow.truckPickupSide === "right" ? "left" : "right" },
            label: "Byt trucksida",
          },
        });
      }
    }
  }

  /* ── R-201 Truckgatan får inte plats ────────────────────────────────── */
  if (layout.aisle && !boxContains(hall, layout.aisle.box, 1)) {
    out.push({
      code: "R-201",
      severity: "error",
      title: "Truckgatan får inte plats i hallen",
      detail: `Truckgatan behöver ${m(TRUCK_AISLE_MM)} m fri bredd men hamnar utanför hallens ${m(config.hall.widthMm)} m. Byt trucksida eller bredda hallen.`,
      instanceIds: [],
      anchor: boxCenter(layout.aisle.box),
      fix: {
        kind: "flow",
        patch: { truckPickupSide: config.flow.truckPickupSide === "right" ? "left" : "right" },
        label: "Byt trucksida",
      },
    });
  }

  /* ── R-202 För kort buffert på sista transportören ──────────────────── */
  const parametric = [...line].reverse().find((p) => p.machine.parametricLength);
  if (parametric) {
    const needed = config.product.packageLengthMm * 2;
    if (parametric.size.lengthMm < needed) {
      out.push({
        code: "R-202",
        severity: "warning",
        title: "För kort buffert före utlastning",
        detail: `${parametric.machine.name} är ${m(parametric.size.lengthMm)} m. För två pakets buffert behövs minst ${m(needed)} m.`,
        instanceIds: [parametric.instanceId],
        anchor: boxCenter(parametric.bbox),
        fix: {
          kind: "flow",
          patch: { finalConveyorLengthMm: needed },
          label: `Förläng till ${m(needed)} m`,
        },
      });
    }
  }

  /* ── R-203 Hjälpobjekt står i truckgatan ────────────────────────────── */
  if (layout.aisle) {
    for (const p of aux) {
      if (!boxesOverlap(p.bbox, layout.aisle.box, TOUCH_TOLERANCE_MM)) continue;
      const isDesk = p.machine.category === "control";
      out.push({
        code: "R-203",
        severity: "error",
        title: `${p.machine.name} står i truckgatan`,
        detail: `${p.machine.name} ligger på samma sida som trucken hämtar. Trucken kan inte passera.`,
        instanceIds: [p.instanceId],
        anchor: boxCenter(p.bbox),
        fix: isDesk
          ? {
              kind: "flow",
              patch: { controlDeskSide: config.flow.controlDeskSide === "right" ? "left" : "right" },
              label: "Flytta pulpeten till andra sidan",
            }
          : {
              kind: "flow",
              patch: {
                stickerMagazineSide: config.flow.stickerMagazineSide === "right" ? "left" : "right",
              },
              label: "Flytta magasinet till andra sidan",
            },
      });
    }
  }

  /* ── R-204 Magasinet nås inte utan att korsa flödet ─────────────────── */
  const magazine = aux.find((p) => p.machine.id === "sf3");
  if (magazine && layout.aisle && line.length > 0) {
    const from = boxCenter(layout.aisle.box);
    const to = boxCenter(magazine.bbox);
    const blocking = line.filter((p) => segmentIntersectsBox(from, to, p.bbox));
    if (blocking.length > 0) {
      out.push({
        code: "R-204",
        severity: "warning",
        title: "Magasinet nås inte utan att korsa flödet",
        detail: `Trucken måste passera ${blocking.map((b) => b.machine.name).join(", ")} för att fylla ${magazine.machine.name}.`,
        instanceIds: [magazine.instanceId, ...blocking.map((b) => b.instanceId)],
        anchor: boxCenter(magazine.bbox),
        fix: {
          kind: "flow",
          patch: {
            stickerMagazineSide: config.flow.stickerMagazineSide === "right" ? "left" : "right",
          },
          label: "Flytta magasinet till trucksidan",
        },
      });
    }
  }

  /* ── R-206 Linjen slutar inte där kunden vill ───────────────────────── */
  if (config.flow.endPoint && layout.lineEnd) {
    const gap = layout.metrics.endPointGapMm ?? 0;
    if (gap > END_POINT_TOLERANCE_MM) {
      out.push({
        code: "R-206",
        severity: "warning",
        title: "Linjen slutar inte vid slutpunkten",
        detail: config.flow.fitToEndPoint
          ? `Linjen slutar ${m(gap)} m från slutpunkten trots automatisk anpassning. Sista transportörens längd räcker inte hela vägen — flytta slutpunkten eller lägg till en transportör.`
          : `Linjen slutar ${m(gap)} m från slutpunkten. Slå på automatisk anpassning eller justera sista transportörens längd.`,
        instanceIds: [],
        anchor: layout.lineEnd,
        fix: config.flow.fitToEndPoint
          ? undefined
          : { kind: "flow", patch: { fitToEndPoint: true }, label: "Anpassa längden automatiskt" },
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

  /* ── R-601 Kedjan är felsorterad ────────────────────────────────────── */
  for (let i = 0; i < line.length - 1; i++) {
    const a = CATEGORY_ORDER.indexOf(line[i].machine.category);
    const b = CATEGORY_ORDER.indexOf(line[i + 1].machine.category);
    if (a <= b) continue;
    out.push({
      code: "R-601",
      severity: "info",
      title: "Ovanlig ordning i linjen",
      detail: `${line[i].machine.name} står före ${line[i + 1].machine.name}. Kontrollera att ordningen är avsedd.`,
      instanceIds: [line[i].instanceId, line[i + 1].instanceId],
      anchor: boxCenter(line[i].bbox),
    });
  }

  /* ── Maskiner som inte gick att koppla in ───────────────────────────── */
  for (const u of layout.unplaced) {
    out.push({
      code: "R-102",
      severity: "error",
      title: "Maskinen kunde inte kopplas in",
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
