import { closeCorners, fitDoorToWall, WALL_THICKNESS_MM } from "./walls";
import type { Box, DrawnKind, DrawnObject, Vec2 } from "./types";

/**
 * Från uppläst ritning till ritade objekt.
 *
 * När assistenten läser en kundritning tänker den i linjer: väggen går härifrån
 * dit, porten sitter där. Verktyget lagrar lådor. Översättningen hör hemma här,
 * på ett ställe, och inte i verktygsskalet — dels för att den går att testa,
 * dels för att den måste följa exakt samma regler som när en människa ritar:
 * väggar snappar till axel, hörn stängs, portar sätts in i väggen.
 *
 * Modulen rättar aldrig tyst. Allt den justerar — en sned vägg som rätas, en
 * port utan vägg, en linje utanför hallen — kommer tillbaka som en anteckning
 * så att både assistenten och kunden får veta vad som inte stämde i underlaget.
 */

/** Kortare än så är inte en vägg utan ett misstag. */
export const MIN_WALL_MM = 500;
/** Hur snett en linje får ligga innan rätningen är värd att nämna, mm. */
const SKEW_NOTE_MM = 150;
/** Hur långt från en vägg en port får ritas och ändå räknas som en öppning i den. */
export const DOOR_REACH_MM = 2500;
/** Samma tak som schemat: config.drawn tar 80 objekt. */
export const MAX_DRAWN = 80;

/**
 * En uppläst ritning ger markeringar, inte murar.
 *
 * Kunden ritar in var väggarna går för att linjen ska hamna rätt i lokalen —
 * inte för att bygga huset. Höjd noll betyder just det: en linje på golvet som
 * säger "här går väggen", ritad som streck i planen och platt i 3D. Den som
 * vill ha en vägg med höjd sätter höjden själv i inspektorn.
 *
 * Regelverket bryr sig inte om skillnaden: en maskin som står i en markerad
 * vägg står i en vägg, och R-403 säger ifrån lika bestämt.
 */
const MARKING_HEIGHT_MM = 0;

export const KIND_LABEL: Record<DrawnKind, string> = {
  wall: "Vägg",
  door: "Port",
  truck: "Truckzon",
  nogo: "No-go-zon",
};

/** Namnger nästa objekt av samma slag: Port A, Port B, Vägg 1, Vägg 2 … */
export function nextName(kind: DrawnKind, existing: DrawnObject[]): string {
  const count = existing.filter((d) => d.kind === kind).length;
  if (kind === "door") return `Port ${String.fromCharCode(65 + count)}`;
  return `${KIND_LABEL[kind]} ${count + 1}`;
}

export type PlanWall = { name?: string; from: Vec2; to: Vec2 };
export type PlanDoor = { name?: string; at: Vec2; widthMm: number };
export type PlanArea = { kind: "truck" | "nogo"; name?: string; box: Box };
export type Plan = { walls?: PlanWall[]; doors?: PlanDoor[]; areas?: PlanArea[] };

export type PlanResult = { drawn: DrawnObject[]; notes: string[] };

const round = (v: number) => Math.round(v);

/**
 * Rätar en linje till närmaste axel och ger den tjocklek.
 *
 * Ritningar är sällan exakt vinkelräta när de mäts ur en bild, och en vägg som
 * ligger två grader snett blir en låda som inte kan möta någon annan.
 */
export function wallFromLine(from: Vec2, to: Vec2): { box: Box; skewMm: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const half = Math.round(WALL_THICKNESS_MM / 2);

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (Math.abs(dx) < MIN_WALL_MM) return null;
    const y = round((from.y + to.y) / 2);
    return {
      box: { x: round(Math.min(from.x, to.x)), y: y - half, l: round(Math.abs(dx)), w: WALL_THICKNESS_MM },
      skewMm: Math.abs(dy),
    };
  }

  if (Math.abs(dy) < MIN_WALL_MM) return null;
  const x = round((from.x + to.x) / 2);
  return {
    box: { x: x - half, y: round(Math.min(from.y, to.y)), l: WALL_THICKNESS_MM, w: round(Math.abs(dy)) },
    skewMm: Math.abs(dx),
  };
}

/**
 * Bygger ritade objekt av en uppläst plan.
 *
 * Väggarna först och i ordning, så att varje ny vägg kan stänga hörnet mot dem
 * som redan finns — samma gång som när man drar dem för hand. Portarna sist,
 * när väggarna de ska sitta i är på plats.
 */
export function planToDrawn(
  plan: Plan,
  hall: { lengthMm: number; widthMm: number },
  existing: DrawnObject[] = [],
): PlanResult {
  const notes: string[] = [];
  const drawn: DrawnObject[] = [];
  const all = () => [...existing, ...drawn];

  let serial = 0;
  const id = (kind: DrawnKind) => `ai-${kind}-${Date.now().toString(36)}-${(serial += 1).toString(36)}`;

  let clamped = 0;
  const insideHall = (point: Vec2): Vec2 => {
    const x = Math.min(Math.max(point.x, 0), hall.lengthMm);
    const y = Math.min(Math.max(point.y, 0), hall.widthMm);
    if (x !== point.x || y !== point.y) clamped += 1;
    return { x, y };
  };

  const room = () => MAX_DRAWN - all().length;

  for (const wall of plan.walls ?? []) {
    if (room() <= 0) break;
    const line = wallFromLine(insideHall(wall.from), insideHall(wall.to));
    if (!line) {
      notes.push(
        `En vägg var kortare än ${MIN_WALL_MM / 1000} m och ritades inte. Kontrollera underlaget.`,
      );
      continue;
    }
    if (line.skewMm > SKEW_NOTE_MM) {
      notes.push(
        `En vägg låg ${Math.round(line.skewMm)} mm snett i underlaget och rätades till närmaste axel.`,
      );
    }
    const walls = all().filter((d) => d.kind === "wall");
    const box = closeCorners(line.box, walls);
    drawn.push({
      id: id("wall"),
      kind: "wall",
      name: wall.name?.trim() || nextName("wall", all()),
      x: round(box.x),
      y: round(box.y),
      l: round(box.l),
      w: round(box.w),
      h: MARKING_HEIGHT_MM,
    });
  }

  for (const area of plan.areas ?? []) {
    if (room() <= 0) break;
    const from = insideHall({ x: area.box.x, y: area.box.y });
    const to = insideHall({ x: area.box.x + area.box.l, y: area.box.y + area.box.w });
    const l = Math.abs(to.x - from.x);
    const w = Math.abs(to.y - from.y);
    if (l < MIN_WALL_MM || w < MIN_WALL_MM) {
      notes.push(`En ${KIND_LABEL[area.kind].toLowerCase()} var för liten för att ritas.`);
      continue;
    }
    drawn.push({
      id: id(area.kind),
      kind: area.kind,
      name: area.name?.trim() || nextName(area.kind, all()),
      x: round(Math.min(from.x, to.x)),
      y: round(Math.min(from.y, to.y)),
      l: round(l),
      w: round(w),
      h: 0,
    });
  }

  for (const door of plan.doors ?? []) {
    if (room() <= 0) break;
    const at = insideHall(door.at);
    const width = Math.max(MIN_WALL_MM, round(door.widthMm));
    const walls = all().filter((d) => d.kind === "wall");
    // Porten ritas som en kvadrat kring sin punkt; väggen bestämmer sedan
    // riktning, läge och tjocklek precis som när kunden drar den för hand.
    const guess: Box = { x: at.x - width / 2, y: at.y - width / 2, l: width, w: width };
    const fitted = fitDoorToWall(guess, walls, DOOR_REACH_MM);
    if (!fitted) {
      notes.push(
        `En port hamnade inte i någon vägg (${Math.round(at.x / 100) / 10} × ` +
          `${Math.round(at.y / 100) / 10} m) och ritades som en fristående öppning.`,
      );
    }
    const box = fitted ?? guess;
    drawn.push({
      id: id("door"),
      kind: "door",
      name: door.name?.trim() || nextName("door", all()),
      x: round(box.x),
      y: round(box.y),
      l: round(box.l),
      w: round(box.w),
      h: MARKING_HEIGHT_MM,
    });
  }

  if (clamped > 0) {
    notes.push(
      `${clamped} punkt${clamped === 1 ? "" : "er"} låg utanför hallens mått och drogs in till kanten. ` +
        "Stämmer hallens längd och bredd med ritningen?",
    );
  }
  const missed = (plan.walls?.length ?? 0) + (plan.doors?.length ?? 0) + (plan.areas?.length ?? 0);
  if (drawn.length + existing.length >= MAX_DRAWN && missed > drawn.length) {
    notes.push(`Ritningen rymmer ${MAX_DRAWN} objekt; resten togs inte med.`);
  }

  return { drawn, notes };
}
