import { scaleZones } from "@/lib/geometry";
import { suggestPorts } from "./stepConvert";
import type { Machine, Port } from "@/lib/types";

/**
 * Att ta över mått ur en konverterad modell.
 *
 * Modellen är ritningen. Måtten ur den är mätta, inte uppskattade, och tas
 * därför över automatiskt — de är sanningen om maskinen.
 *
 * Fotavtryck och portar hänger ihop: schemat kräver att varje port ligger
 * innanför maskinen. Portarna skalas därför med måtten, och vilka som
 * flyttades rapporteras tillbaka så att det kan sägas rakt ut i
 * gränssnittet i stället för att ändras i tysthet.
 */

export type ApplyResult = { machine: Machine; movedPorts: string[]; scaledZones: number };

export function applyModelFootprint(
  machine: Machine,
  footprint: { lengthMm: number; widthMm: number; heightMm: number },
): ApplyResult {
  const from = machine.footprint;
  // Portarna skalas i stället för att klippas. Måtten kommer från samma
  // maskin, bara uppmätta i stället för uppskattade, så en port som satt mitt
  // på maskinen ska sitta mitt på den även efteråt. Att klippa skulle samla
  // alla portar vid kanten när måtten krymper.
  const lr = from.lengthMm > 0 ? footprint.lengthMm / from.lengthMm : 1;
  const wr = from.widthMm > 0 ? footprint.widthMm / from.widthMm : 1;

  const movedPorts: string[] = [];
  const ports: Port[] = machine.ports.map((port) => {
    const x = Math.min(footprint.lengthMm, Math.max(0, Math.round(port.pos.x * lr)));
    const y = Math.min(footprint.widthMm, Math.max(0, Math.round(port.pos.y * wr)));
    if (x !== port.pos.x || y !== port.pos.y) movedPorts.push(port.id);
    return { ...port, pos: { x, y } };
  });

  /*
   * Zonerna räknas om med. En servicezon är definierad längs maskinen den
   * tillhör; byts måttet utan att zonen följer med sticker den ut förbi
   * maskinen eller slutar mitt på den. Regeln är densamma som solvern och
   * utförandena använder: zoner som spänner över maskinen behåller sina
   * marginaler, zoner inuti den skalas.
   */
  const zones = scaleZones(machine.zones, from, footprint);
  const movedZones = zones.filter((z, i) => JSON.stringify(z) !== JSON.stringify(machine.zones[i]));

  return {
    machine: {
      ...machine,
      footprint,
      ports,
      zones,
      // Måtten kommer nu ur geometrin, men portlägen och nollpunkt är
      // fortfarande gissningar tills en konstruktör har sett dem.
      dimensionsVerified: false,
    },
    movedPorts,
    scaledZones: movedZones.length,
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
