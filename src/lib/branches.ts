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
  /** Grenens rot, eller null för huvudlinjen och för matarlinjer. */
  branch: { fromInstanceId: string; outPortId: string } | null;
  /**
   * Matarlinjens mål, eller null. En matarlinje slutar i en annan maskins
   * ingång i stället för att utgå från dess utgång — se LineItem.feeds.
   */
  feeds: { toInstanceId: string; inPortId: string } | null;
  /** Poster i grenen, i listans ordning. */
  items: LineItem[];
  /** Index i den platta listan, parallellt med items. */
  indices: number[];
};

/** Delar upp linjen i huvudlinje, grenar och matarlinjer. */
export function segments(line: LineItem[]): Segment[] {
  const out: Segment[] = [];
  line.forEach((item, index) => {
    if (out.length === 0 || item.branch || item.feeds) {
      out.push({
        branch: item.branch ?? null,
        feeds: item.feeds ?? null,
        items: [item],
        indices: [index],
      });
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
  // En matarlinje hänger i sitt mål på samma sätt: utan maskinen den matar
  // finns ingen ingång att sluta i.
  for (let changed = true; changed; ) {
    changed = false;
    for (const segment of segments(line)) {
      const anchor = segment.branch?.fromInstanceId ?? segment.feeds?.toInstanceId;
      if (!anchor || !doomed.has(anchor)) continue;
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
    index === 0 && (item.branch || item.feeds)
      ? { ...item, branch: undefined, feeds: undefined }
      : item,
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

/**
 * Ingångar som redan har något kopplat till sig.
 *
 * Maskinens första ingång tas av föregångaren i den egna grenen — det är den
 * kedjan kopplas ihop med. Övriga är lediga tills en matarlinje slutar i dem.
 */
export function usedInPorts(line: LineItem[], instanceId: string, machine: Machine): Set<string> {
  const used = new Set<string>();

  for (const segment of segments(line)) {
    const at = segment.items.findIndex((i) => i.instanceId === instanceId);
    // Står maskinen efter någon i sin gren, eller är den en grenrot, går
    // flödet in genom den ingång som valts för den — inte nödvändigtvis den
    // första. Samma val styr hur maskinen vrids, se LineItem.inPortId.
    if (at > 0 || (at === 0 && segment.branch)) {
      used.add(inPortOf(segment.items[at], machine));
    }
    // Matarlinjer som slutar här tar sin egen.
    if (segment.feeds?.toInstanceId === instanceId) used.add(segment.feeds.inPortId);
  }

  used.delete("");
  return used;
}

/**
 * Ingångar som en matarlinje redan mynnar i.
 *
 * De kan inte också ta emot huvudflödet — två linjer i samma ingång är inte
 * en sammanslagning utan två maskiner på samma punkt.
 */
export function feedInPorts(line: LineItem[], instanceId: string): Set<string> {
  const out = new Set<string>();
  for (const item of line) {
    if (item.feeds && item.feeds.toInstanceId === instanceId) out.add(item.feeds.inPortId);
  }
  return out;
}

/** Ingången posten tar emot flödet i. Utan val gäller maskinens första. */
export function inPortOf(item: LineItem | undefined, machine: Machine): string {
  const ins = machine.ports.filter((p) => p.role === "in");
  return ins.find((p) => p.id === item?.inPortId)?.id ?? ins[0]?.id ?? "";
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
/**
 * Kopplingarna i linjen, med portarna de sitter i.
 *
 * Reglerna behöver veta vem som lämnar till vem, och genom vilka portar. Att
 * i stället jämföra grannar i listan höll bara så länge linjen var en rak
 * kedja: en grenrot kan ha nummer 3 och sitta på nummer 1, och en matarlinje
 * ligger sist i listan men mynnar mitt i den.
 */
export type Connection = {
  fromInstanceId: string;
  /** Utgången flödet lämnar genom, eller undefined för maskinens första. */
  fromPortId?: string;
  toInstanceId: string;
  /** Ingången flödet tas emot i, eller undefined för maskinens första. */
  toPortId?: string;
};

export function connections(line: LineItem[]): Connection[] {
  const out: Connection[] = [];

  for (const segment of segments(line)) {
    for (let i = 1; i < segment.items.length; i++) {
      out.push({
        fromInstanceId: segment.items[i - 1].instanceId,
        fromPortId: segment.items[i - 1].outPortId,
        toInstanceId: segment.items[i].instanceId,
        toPortId: segment.items[i].inPortId,
      });
    }

    if (segment.branch) {
      out.push({
        fromInstanceId: segment.branch.fromInstanceId,
        fromPortId: segment.branch.outPortId,
        toInstanceId: segment.items[0].instanceId,
        toPortId: segment.items[0].inPortId,
      });
    }

    if (segment.feeds) {
      const last = segment.items[segment.items.length - 1];
      out.push({
        fromInstanceId: last.instanceId,
        fromPortId: last.outPortId,
        toInstanceId: segment.feeds.toInstanceId,
        toPortId: segment.feeds.inPortId,
      });
    }
  }

  return out;
}

export function connectedPairs(line: LineItem[]): Set<string> {
  const key = (a: string, b: string) => [a, b].sort().join("|");
  const pairs = new Set<string>();

  for (const segment of segments(line)) {
    for (let i = 1; i < segment.items.length; i++) {
      pairs.add(key(segment.items[i - 1].instanceId, segment.items[i].instanceId));
    }
    // En matarlinjes sista maskin är inkopplad i målets ingång.
    if (segment.feeds) {
      pairs.add(
        key(segment.feeds.toInstanceId, segment.items[segment.items.length - 1].instanceId),
      );
    }
    if (segment.branch) {
      pairs.add(key(segment.branch.fromInstanceId, segment.items[0].instanceId));
    }
  }

  return pairs;
}
