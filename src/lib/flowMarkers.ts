import type { Flow, FlowMarker, Vec2 } from "./types";

/**
 * Start- och slutpunkter med motivering.
 *
 * Maskinerna står där de ställs, men den som läser ritningen behöver veta var
 * paketen kommer in och var de ska ut — och ofta finns det mer än ett svar:
 * paketen kan komma från sågen eller från hyvleriet, trucken kan hämta vid
 * port A eller vid gaveln. Punkterna här är sådana markeringar, var och en med
 * en rad om varför, så att det man jämförde inte glöms bort.
 *
 * Den aktiva startpunkten (flow.startPoint) är dessutom där nya maskiner
 * läggs. En alternativ start kan göras till den aktiva.
 *
 * Funktionerna ändrar en flödeskopia på plats; storen står för ångra.
 */

/** Lika många som schemat tar emot. */
export const MAX_MARKERS = 12;

let serial = 0;
export function newMarkerId(): string {
  serial += 1;
  return `mk-${Date.now().toString(36)}-${serial.toString(36)}`;
}

/**
 * Numret i namnet: den aktiva startpunkten är Start 1, så alternativen börjar
 * på 2. Slutpunkterna har ingen aktiv och börjar på 1.
 */
export function markerNumber(flow: Flow, marker: FlowMarker): number {
  const same = (flow.markers ?? []).filter((m) => m.role === marker.role);
  return same.indexOf(marker) + (marker.role === "start" ? 2 : 1);
}

/**
 * Lägger till en punkt en bit från startpunkten, så att den syns och går att
 * ta tag i direkt. En slutpunkt hamnar vid hallens bortre ände.
 */
export function addMarker(
  flow: Flow,
  role: FlowMarker["role"],
  hall: { lengthMm: number; widthMm: number },
  at?: Vec2,
): FlowMarker | null {
  const markers = (flow.markers ??= []);
  if (markers.length >= MAX_MARKERS) return null;
  const count = markers.filter((m) => m.role === role).length;
  const x = role === "start" ? flow.startPoint.x : Math.max(0, hall.lengthMm - 2000);
  const y = role === "start" ? flow.startPoint.y - 3000 * (count + 1) : flow.startPoint.y - 3000 * count;
  const marker: FlowMarker = {
    id: newMarkerId(),
    role,
    pos: at ?? { x, y: Math.min(hall.widthMm, Math.max(0, y)) },
    comment: "",
  };
  markers.push(marker);
  return marker;
}

export function removeMarker(flow: Flow, id: string): void {
  flow.markers = (flow.markers ?? []).filter((m) => m.id !== id);
}

/**
 * Gör en alternativ start till den aktiva. Den som var aktiv blir kvar som
 * alternativ med sin kommentar, så att bytet går att göra tillbaka.
 */
export function activateMarker(flow: Flow, id: string): void {
  const marker = flow.markers?.find((m) => m.id === id);
  if (!marker || marker.role !== "start") return;
  const previous = { pos: flow.startPoint, comment: flow.startComment ?? "" };
  flow.startPoint = marker.pos;
  flow.startComment = marker.comment || undefined;
  marker.pos = previous.pos;
  marker.comment = previous.comment;
}
