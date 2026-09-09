import { suggestPorts } from "./stepConvert";
import type { Machine, Port } from "@/lib/types";

/**
 * Att ta över mått ur en konverterad modell.
 *
 * Fotavtryck och portar hänger ihop: schemat kräver att varje port ligger
 * innanför maskinen. Att bara skriva in nya mått lämnade portarna där de var,
 * och maskinen gick inte längre att spara — knappen Spara gjorde ingenting
 * och sa inte varför. Här flyttas portarna med, och vilka som flyttades
 * rapporteras tillbaka så att det kan sägas rakt ut i gränssnittet.
 */

export type ApplyResult = { machine: Machine; movedPorts: string[] };

export function applyModelFootprint(
  machine: Machine,
  footprint: { lengthMm: number; widthMm: number; heightMm: number },
): ApplyResult {
  const movedPorts: string[] = [];
  const ports: Port[] = machine.ports.map((port) => {
    const x = Math.min(port.pos.x, footprint.lengthMm);
    const y = Math.min(port.pos.y, footprint.widthMm);
    if (x !== port.pos.x || y !== port.pos.y) movedPorts.push(port.id);
    return { ...port, pos: { x, y } };
  });

  return {
    machine: {
      ...machine,
      footprint,
      ports,
      // Måtten kommer nu ur geometrin, men portlägen och nollpunkt är
      // fortfarande gissningar tills en konstruktör har sett dem.
      dimensionsVerified: false,
    },
    movedPorts,
  };
}

/**
 * Portförslaget räknas ur maskinens EGET fotavtryck, inte ur modellens.
 * Annars hamnar portarna utanför maskinen när måtten inte är övertagna.
 */
export function applySuggestedPorts(machine: Machine): Machine {
  return {
    ...machine,
    ports: suggestPorts(machine.footprint),
    dimensionsVerified: false,
  };
}
