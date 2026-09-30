import type { Flow, FlowMarker, Vec2 } from "./types";

/**
 * Start- och slutpunkter med motivering.
 *
 * Linjen byggs alltid från en start till en slut. Men i en förstudie finns
 * ofta flera tänkbara lägen — paketen kan komma från sågen eller från
 * hyvleriet, trucken kan hämta vid port A eller vid gaveln — och det är
 * värdefullt att ha dem kvar i ritningen, med en rad om varför, i stället för
 * att bara flytta den enda punkten fram och tillbaka och glömma bort vad man
 * jämförde med.
 *
 * Funktionerna här ändrar en flödeskopia på plats; storen står för ångra.
 */

/** Lika många som schemat tar emot. */
export const MAX_MARKERS = 12;

export const ROLE_LABEL: Record<FlowMarker["role"], string> = {
  start: "Start",
  end: "Slut",
};

/** Förklaringen som visas vid varje start- och slutpunkt. */
export const ROLE_HELP: Record<FlowMarker["role"], string> = {
  start:
    "Var paketen kommer in i anläggningen — från sågen, en annan linje eller en truckport. " +
    "Linjen byggs från den aktiva startpunkten.",
  end:
    "Var de färdiga paketen ska lämnas — vid en port, en hämtzon eller ett lager. " +
    "Linjen sträcks mot den aktiva slutpunkten.",
};

let serial = 0;
export function newMarkerId(): string {
  serial += 1;
  return `mk-${Date.now().toString(36)}-${serial.toString(36)}`;
}

/** Namnger alternativen: Start 2, Start 3, Slut 2 … — den aktiva är nummer 1. */
export function markerLabel(flow: Flow, marker: FlowMarker): string {
  const same = (flow.markers ?? []).filter((m) => m.role === marker.role);
  return `${ROLE_LABEL[marker.role]} ${same.indexOf(marker) + 2}`;
}

/**
 * Lägger till en alternativ punkt en bit från den aktiva, så att den syns och
 * går att ta tag i direkt.
 */
export function addMarker(flow: Flow, role: FlowMarker["role"], at?: Vec2): FlowMarker | null {
  const markers = (flow.markers ??= []);
  if (markers.length >= MAX_MARKERS) return null;
  const anchor = role === "start" ? flow.startPoint : (flow.endPoint ?? flow.startPoint);
  const offset = 3000 * (markers.filter((m) => m.role === role).length + 1);
  const marker: FlowMarker = {
    id: newMarkerId(),
    role,
    pos: at ?? { x: anchor.x, y: Math.max(0, anchor.y - offset) },
    comment: "",
  };
  markers.push(marker);
  return marker;
}

export function removeMarker(flow: Flow, id: string): void {
  flow.markers = (flow.markers ?? []).filter((m) => m.id !== id);
}

/**
 * Gör ett alternativ till den aktiva punkten. Den som var aktiv blir kvar som
 * alternativ med sin kommentar, så att bytet går att göra tillbaka.
 */
export function activateMarker(flow: Flow, id: string): void {
  const marker = flow.markers?.find((m) => m.id === id);
  if (!marker) return;

  if (marker.role === "start") {
    const previous = { pos: flow.startPoint, comment: flow.startComment ?? "" };
    flow.startPoint = marker.pos;
    flow.startComment = marker.comment || undefined;
    marker.pos = previous.pos;
    marker.comment = previous.comment;
    return;
  }

  if (flow.endPoint) {
    const previous = { pos: flow.endPoint, comment: flow.endComment ?? "" };
    flow.endPoint = marker.pos;
    flow.endComment = marker.comment || undefined;
    marker.pos = previous.pos;
    marker.comment = previous.comment;
  } else {
    // Ingen aktiv slutpunkt att byta med: alternativet flyttar in och tas bort.
    flow.endPoint = marker.pos;
    flow.endComment = marker.comment || undefined;
    removeMarker(flow, id);
  }
}
