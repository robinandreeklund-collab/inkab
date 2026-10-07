import { DIR_VEC } from "./geometry";
import type { Placement, PlacedPort } from "./types";

/**
 * Vilka maskiner som faktiskt hänger ihop.
 *
 * Med fri placering finns ingen kedja som säger vad som sitter efter vad —
 * maskinerna står där kunden ställt dem. Men portarna vet: en utgång som
 * mynnar framför en annan maskins ingång, åt samma håll som paketen går, är
 * en överföring. Det räcker för att regelverket ska kunna skilja en linje
 * från maskiner som bara råkar stå nära varandra.
 */

/**
 * Hur långt fram längs flödet nästa maskins ingång får ligga, mm. Maskinzonerna
 * ger 1,2–2 m mellan maskinerna i en vanlig linje; lite till får plats för den
 * som ställer ut för hand.
 */
export const CONNECT_REACH_MM = 3000;
/** Hur mycket portarna får vara förskjutna i sidled och ändå mötas, mm — ungefär ett paket brett. Katalogens portar sitter inte alltid mitt på maskinen. */
const LATERAL_TOLERANCE_MM = 1200;
/** Räckvidd för en överföring i ett hörn, till en port som tar emot från sidan, mm. */
const TURN_REACH_MM = 2000;
/** Hur långt bakom utgången en ingång får ligga och ändå räknas som framför den, mm. */
const BEHIND_TOLERANCE_MM = 300;

export type Connection = { from: string; to: string };
/** Två portar av samma slag som möts — en maskin som står åt fel håll. */
export type Mismatch = { a: string; b: string; role: "in" | "out"; at: { x: number; y: number } };

const distance = (a: PlacedPort, b: PlacedPort) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);

/** Hur långt fram längs portens riktning, och hur långt åt sidan, den andra porten ligger. */
function offset(from: PlacedPort, to: PlacedPort): { ahead: number; lateral: number } {
  const v = DIR_VEC[from.dir];
  const dx = to.pos.x - from.pos.x;
  const dy = to.pos.y - from.pos.y;
  return { ahead: dx * v.x + dy * v.y, lateral: Math.abs(dx * -v.y + dy * v.x) };
}

/** Två portar på samma flödeslinje, högst CONNECT_REACH_MM isär. */
function inLine(a: PlacedPort, b: PlacedPort): boolean {
  const { ahead, lateral } = offset(a, b);
  return lateral <= LATERAL_TOLERANCE_MM && Math.abs(ahead) <= CONNECT_REACH_MM;
}

function turns(p: Placement, port: PlacedPort): boolean {
  return p.machine.ports.find((x) => x.id === port.id)?.allowsDirectionChange ?? false;
}

export function findConnections(placements: Placement[]): {
  connections: Connection[];
  mismatches: Mismatch[];
} {
  const connections: Connection[] = [];
  const mismatches: Mismatch[] = [];
  const line = placements.filter((p) => !p.aux);

  for (const a of line) {
    for (const b of line) {
      if (a === b) continue;
      for (const out of a.ports.filter((x) => x.role === "out")) {
        for (const inp of b.ports.filter((x) => x.role === "in")) {
          const { ahead, lateral } = offset(out, inp);
          if (ahead < -BEHIND_TOLERANCE_MM) continue;
          const straight =
            out.dir === inp.dir && lateral <= LATERAL_TOLERANCE_MM && ahead <= CONNECT_REACH_MM;
          // En port som tar emot eller lämnar åt sidan: ett hörn. Avståndet
          // räcker inte — två maskiner som bara står bredvid varandra ska inte
          // räknas som ihopkopplade. Flödet måste kunna svänga: riktningarna
          // får inte gå mot varandra, och utgången måste ligga uppströms om
          // ingången räknat i ingångens riktning.
          const corner =
            (turns(a, out) || turns(b, inp)) &&
            out.dir !== inp.dir &&
            !opposite(out, inp) &&
            distance(out, inp) <= TURN_REACH_MM &&
            offset(inp, out).ahead <= BEHIND_TOLERANCE_MM;
          if (straight || corner) connections.push({ from: a.instanceId, to: b.instanceId });
        }
      }
    }
  }

  // Utgång mot utgång eller ingång mot ingång, vända mot varandra: den ena
  // maskinen står baklänges. Bara mellan maskiner som inte redan hänger ihop.
  for (let i = 0; i < line.length; i++) {
    for (let j = i + 1; j < line.length; j++) {
      const a = line[i];
      const b = line[j];
      if (isLinked(connections, a.instanceId, b.instanceId)) continue;
      for (const pa of a.ports) {
        const pb = b.ports.find(
          (x) => x.role === pa.role && opposite(pa, x) && inLine(pa, x),
        );
        if (!pb) continue;
        mismatches.push({
          a: a.instanceId,
          b: b.instanceId,
          role: pa.role,
          at: { x: (pa.pos.x + pb.pos.x) / 2, y: (pa.pos.y + pb.pos.y) / 2 },
        });
        break;
      }
    }
  }

  return { connections, mismatches };
}

function opposite(a: PlacedPort, b: PlacedPort): boolean {
  const va = DIR_VEC[a.dir];
  const vb = DIR_VEC[b.dir];
  return va.x === -vb.x && va.y === -vb.y;
}

/** Sant om två maskiner för paket mellan sig, åt något håll. */
export function isLinked(connections: Connection[], a: string, b: string): boolean {
  return connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}
