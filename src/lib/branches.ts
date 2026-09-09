import type { LineItem, Machine } from "./types";

/**
 * Linjen som träd, lagrad platt.
 *
 * Listan behåller sin ordning — den styr numrering, offertrader och ångra —
 * och grenarna ligger i länkarna. En post med `branch` startar en gren på en
 * tidigare maskins utgång, och allt som följer hör till samma gren tills
 * nästa grenrot.
 *
 * Den platta lagringen är ett medvetet val. En riktig trädstruktur skulle
 * göra varje operation till en trädoperation — ordna om, ta bort, exportera —
 * medan det som faktiskt behöver vara ett träd är geometrin, inte listan.
 */

export type Segment = {
  /** Grenens rot, eller null för huvudlinjen. */
  branch: { fromInstanceId: string; outPortId: string } | null;
  /** Poster i grenen, i listans ordning. */
  items: LineItem[];
  /** Index i den platta listan, parallellt med items. */
  indices: number[];
};

/** Delar upp linjen i huvudlinje och grenar. */
export function segments(line: LineItem[]): Segment[] {
  const out: Segment[] = [];
  line.forEach((item, index) => {
    if (out.length === 0 || item.branch) {
      out.push({ branch: item.branch ?? null, items: [item], indices: [index] });
      return;
    }
    const current = out[out.length - 1];
    current.items.push(item);
    current.indices.push(index);
  });
  return out;
}

/** Var en ny maskin ska in för att hamna sist i samma gren som `instanceId`. */
export function segmentEndIndex(line: LineItem[], instanceId: string | null): number {
  if (!instanceId) return line.length;
  const found = segments(line).find((s) => s.items.some((i) => i.instanceId === instanceId));
  if (!found) return line.length;
  return found.indices[found.indices.length - 1] + 1;
}

/**
 * Tar bort en maskin och allt som hänger på den.
 *
 * En gren vars rot är borta går inte att placera, så den följer med. Att
 * lämna kvar den vore att lämna kvar maskiner som inte kan ritas och inte
 * går att hitta.
 */
export function removeWithBranches(line: LineItem[], instanceId: string): LineItem[] {
  const doomed = new Set([instanceId]);

  // Grenar kan hänga på grenar, så listan gås igenom tills inget nytt faller.
  for (let changed = true; changed; ) {
    changed = false;
    for (const segment of segments(line)) {
      if (!segment.branch || !doomed.has(segment.branch.fromInstanceId)) continue;
      for (const item of segment.items) {
        if (!doomed.has(item.instanceId)) {
          doomed.add(item.instanceId);
          changed = true;
        }
      }
    }
  }

  const kept = line.filter((item) => !doomed.has(item.instanceId));

  // Blir en gren huvudlinje när roten faller måste länken bort, annars pekar
  // den på en maskin som inte finns.
  return kept.map((item, index) =>
    index === 0 && item.branch ? { ...item, branch: undefined } : item,
  );
}

/** Utgångar som redan har något kopplat till sig. */
export function usedOutPorts(line: LineItem[], instanceId: string, machine: Machine): Set<string> {
  const outs = machine.ports.filter((p) => p.role === "out");
  const used = new Set<string>();

  for (const segment of segments(line)) {
    // Fortsättningen i den egna grenen använder maskinens valda utgång.
    const at = segment.items.findIndex((i) => i.instanceId === instanceId);
    if (at >= 0 && at < segment.items.length - 1) {
      used.add(segment.items[at].outPortId ?? outs[0]?.id ?? "");
    }
    // Grenar som utgår härifrån använder sin egen.
    if (segment.branch?.fromInstanceId === instanceId) used.add(segment.branch.outPortId);
  }

  used.delete("");
  return used;
}

/** Namn på grenen för gränssnittet: "Gren från Rullbana · Ut på kortsidan". */
export function branchLabel(
  segment: Segment,
  line: LineItem[],
  nameOf: (item: LineItem) => string,
  portNameOf: (item: LineItem, portId: string) => string,
): string {
  if (!segment.branch) return "Huvudlinje";
  const parent = line.find((i) => i.instanceId === segment.branch!.fromInstanceId);
  if (!parent) return "Gren utan fäste";
  return `Gren från ${nameOf(parent)} · ${portNameOf(parent, segment.branch.outPortId)}`;
}

/**
 * Par av maskiner som är hopkopplade port mot port.
 *
 * Grannar i samma gren, och en grenrot med maskinen den utgår från. Reglerna
 * behöver veta det: en inkopplad granne står med rätta i maskinzonen framåt,
 * och att i stället räkna på positionsnummer höll bara så länge linjen var en
 * rak kedja — i ett träd kan en grenrot ha nummer 3 och sitta på nummer 1.
 */
export function connectedPairs(line: LineItem[]): Set<string> {
  const key = (a: string, b: string) => [a, b].sort().join("|");
  const pairs = new Set<string>();

  for (const segment of segments(line)) {
    for (let i = 1; i < segment.items.length; i++) {
      pairs.add(key(segment.items[i - 1].instanceId, segment.items[i].instanceId));
    }
    if (segment.branch) {
      pairs.add(key(segment.branch.fromInstanceId, segment.items[0].instanceId));
    }
  }

  return pairs;
}
