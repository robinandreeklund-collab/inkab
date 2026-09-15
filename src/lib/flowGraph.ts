import type { Configuration, FlowEdge, FlowGraph, FlowNode, LineItem, Vec2 } from "./types";

/**
 * Flödesskelettet: noder, sträckor och ordningen de ska lösas i.
 *
 * Rena funktioner över grafen, utan geometri. Solvern, reglerna och
 * gränssnittet ställer samma frågor — vilka sträckor går ut från den här
 * noden, vilken sträcka matar in i den, i vilken ordning kan de placeras —
 * och ska få samma svar. Tre egna svar hade blivit tre olika.
 */

/** Grafen används när den finns och har minst en sträcka. */
export function hasFlowGraph(config: Configuration): boolean {
  return (config.flowGraph?.edges.length ?? 0) > 0;
}

export function nodeById(graph: FlowGraph, id: string | null): FlowNode | undefined {
  return id ? graph.nodes.find((n) => n.id === id) : undefined;
}

export function edgeById(graph: FlowGraph, id: string | null): FlowEdge | undefined {
  return id ? graph.edges.find((e) => e.id === id) : undefined;
}

/** Maskinerna som uttryckligen står på en sträcka, i linjelistans ordning. */
export function edgeItems(line: LineItem[], edgeId: string): LineItem[] {
  return line.filter((item) => item.edgeId === edgeId);
}

/**
 * Maskinerna på en sträcka, inklusive de som inte fått någon gren.
 *
 * En linje som byggdes innan flödet ritades har inga grenar i posterna. De
 * maskinerna hör till den första sträckan — det är där de stod. Solvern,
 * linjeremsan och inspektorn måste vara överens om det, annars placeras en
 * maskin i hallen utan att synas i listan.
 */
export function edgeItemsWithFallback(
  line: LineItem[],
  graph: FlowGraph,
  edgeId: string,
): LineItem[] {
  const first = orderedEdges(graph)[0]?.id ?? graph.edges[0]?.id;
  return line.filter((item) => (item.edgeId ?? first) === edgeId);
}

/** Sträckor som lämnar noden. */
export function edgesFrom(graph: FlowGraph, nodeId: string): FlowEdge[] {
  return graph.edges.filter((e) => e.fromNodeId === nodeId);
}

/** Sträckor som mynnar i noden. */
export function edgesTo(graph: FlowGraph, nodeId: string): FlowEdge[] {
  return graph.edges.filter((e) => e.toNodeId === nodeId);
}

/**
 * Sträckan en korsning ärver sitt läge och sin riktning av.
 *
 * Vid en sammanslagning möts flera vägar, men kedjan kan bara vara fysiskt
 * kopplad till en av dem — port mot port. Den första i listan är den, och de
 * andra mäts mot den: når de fram, ligger de på samma höjd. Att i stället
 * utgå från den ritade punkten hade gett en kedja som ser hopkopplad ut i
 * ritningen men inte är det i verkligheten.
 */
export function primaryIncoming(graph: FlowGraph, nodeId: string): FlowEdge | undefined {
  return edgesTo(graph, nodeId)[0];
}

/**
 * Ordningen sträckorna kan placeras i.
 *
 * En sträcka som utgår från en korsning kan inte placeras förrän sträckan som
 * matar korsningen är placerad — det är där den börjar. Resten är fritt.
 * Sträckor som aldrig blir redo ligger i en ring och rapporteras för sig;
 * ingen av dem kan placeras, och att tiga om det vore att rita en halv
 * anläggning utan att säga varför.
 */
export function edgeOrder(graph: FlowGraph): { order: FlowEdge[]; cyclic: FlowEdge[] } {
  const order: FlowEdge[] = [];
  const done = new Set<string>();
  const left = [...graph.edges];

  for (let progress = true; progress; ) {
    progress = false;
    for (let i = 0; i < left.length; ) {
      const edge = left[i];
      const feeder = primaryIncoming(graph, edge.fromNodeId);
      const ready = !feeder || done.has(feeder.id);
      if (ready) {
        order.push(edge);
        done.add(edge.id);
        left.splice(i, 1);
        progress = true;
      } else {
        i++;
      }
    }
  }

  return { order, cyclic: left };
}

/** Sträckor i den ordning de placeras, utan de som ligger i en ring. */
export function orderedEdges(graph: FlowGraph): FlowEdge[] {
  return edgeOrder(graph).order;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y));
}

let counter = 0;
const nextId = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
};

/** Nästa lediga namn i en serie: Inport 1, Inport 2, … */
export function nextNodeName(graph: FlowGraph, kind: FlowNode["kind"]): string {
  const stem = kind === "infeed" ? "Inport" : kind === "outfeed" ? "Utport" : "Korsning";
  const taken = new Set(graph.nodes.filter((n) => n.kind === kind).map((n) => n.name));
  for (let i = 1; ; i++) if (!taken.has(`${stem} ${i}`)) return `${stem} ${i}`;
}

export function nextEdgeName(graph: FlowGraph): string {
  const taken = new Set(graph.edges.map((e) => e.name));
  // A, B, C … och sedan Gren 27 och uppåt när bokstäverna tar slut.
  for (let i = 0; i < 26; i++) {
    const name = `Gren ${String.fromCharCode(65 + i)}`;
    if (!taken.has(name)) return name;
  }
  for (let i = 27; ; i++) if (!taken.has(`Gren ${i}`)) return `Gren ${i}`;
}

export function makeNode(graph: FlowGraph, kind: FlowNode["kind"], at: Vec2, dir: FlowNode["dir"] = "x+"): FlowNode {
  return { id: nextId("nod"), kind, name: nextNodeName(graph, kind), at, dir };
}

export function makeEdge(graph: FlowGraph, fromNodeId: string, toNodeId: string | null): FlowEdge {
  return { id: nextId("gren"), name: nextEdgeName(graph), fromNodeId, toNodeId };
}

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };

/** Grafen med en nod borttagen, och sträckorna som hängde i den. */
export function removeNode(graph: FlowGraph, nodeId: string): FlowGraph {
  return {
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
  };
}
