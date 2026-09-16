import type { Configuration, Dir, FlowEdge, FlowGraph, FlowNode, LineItem, Vec2 } from "./types";

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

/**
 * Riktningen en sträcka ritades i, snäppt till närmaste axel.
 *
 * Pilens riktning är paketens riktning — det är hela vitsen med att rita den.
 * Utan det här lades maskinerna alltid längs hallen oavsett hur pilen pekade,
 * och ritningen blev en dekoration bredvid en linje som gick sin egen väg.
 */
export function edgeDirection(graph: FlowGraph, edge: FlowEdge): Dir | null {
  const from = nodeById(graph, edge.fromNodeId);
  const to = nodeById(graph, edge.toNodeId);
  if (!from || !to) return null;

  const dx = to.at.x - from.at.x;
  const dy = to.at.y - from.at.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "x+" : "x-";
  return dy >= 0 ? "y+" : "y-";
}

/** Hur nära en befintlig nod en pil får släppas för att fästa i den, mm. */
export const SNAP_TO_NODE_MM = 2500;

/**
 * Noden en pilände fäster i, om den ritades nära en.
 *
 * Utan det här blev varje pil en egen ö: fyra ritade pilar gav fyra
 * frikopplade linjer som alla hette "Linjen", i stället för ett flöde som
 * möts. Ingen siktar på en osynlig punkt med millimeterprecision — det är
 * ritverktygets sak att förstå att två ändar som ligger på varandra är samma
 * punkt.
 */
export function nodeNear(graph: FlowGraph, at: Vec2, within = SNAP_TO_NODE_MM): FlowNode | null {
  let best: { node: FlowNode; distance: number } | null = null;
  for (const node of graph.nodes) {
    const away = Math.hypot(node.at.x - at.x, node.at.y - at.y);
    if (away <= within && (!best || away < best.distance)) best = { node, distance: away };
  }
  return best?.node ?? null;
}

/**
 * Är noden en överenskommelse mellan flera grenar?
 *
 * En fri ände är bara där sträckan råkar sluta, och den följer med
 * maskinerna. En delad nod är ett möte: två vägar ska träffas där, och då är
 * avståndet däremellan något att säga till om.
 */
export function isSharedNode(graph: FlowGraph, nodeId: string): boolean {
  return edgesTo(graph, nodeId).length + edgesFrom(graph, nodeId).length > 1;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y));
}

/* ── Vad en sträcka är, av grafens form ────────────────────────────────── */

export type EdgeRole = "line" | "infeed" | "common" | "outfeed" | "spine";

/**
 * Sträckans roll, läst ur grafen.
 *
 * Ingen behöver döpa något. En sträcka som börjar där inget mynnar in är en
 * inmatning; en som slutar där inget fortsätter är en utmatning; en mellan två
 * möten är den gemensamma banan. Namnen följer alltså formen, och formen är
 * det enda kunden faktiskt ritat.
 */
export function edgeRole(graph: FlowGraph, edge: FlowEdge): EdgeRole {
  const fedBy = edgesTo(graph, edge.fromNodeId).length;
  const continues = edge.toNodeId ? edgesFrom(graph, edge.toNodeId).length > 0 : false;

  if (fedBy === 0) return continues ? "infeed" : "line";
  // Går flera vägar ihop här är det den gemensamma banan, vad den än leder
  // till. Det är den maskinerna efter mötet ska klara flödet från allihop.
  if (fedBy > 1) return "common";
  return continues ? "spine" : "outfeed";
}

/** Namnet som visas: kundens eget om hen döpt om, annars ur formen. */
export function edgeLabel(graph: FlowGraph, edge: FlowEdge): string {
  if (edge.name) return edge.name;

  const role = edgeRole(graph, edge);
  if (role === "line") return "Linjen";
  if (role === "common") return "Gemensam bana";
  if (role === "spine") return "Fortsättning";

  const stem = role === "infeed" ? "Inmatning" : "Utmatning";
  const same = graph.edges.filter((e) => !e.name && edgeRole(graph, e) === role);
  const index = same.findIndex((e) => e.id === edge.id);
  return same.length > 1 ? `${stem} ${index + 1}` : stem;
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

export function makeNode(graph: FlowGraph, kind: FlowNode["kind"], at: Vec2, dir: FlowNode["dir"] = "x+"): FlowNode {
  return { id: nextId("nod"), kind, name: nextNodeName(graph, kind), at, dir };
}

export function makeEdge(graph: FlowGraph, fromNodeId: string, toNodeId: string | null): FlowEdge {
  // Namnlös med flit: edgeLabel läser formen. Fältet finns för den som vill
  // döpa en gren till "Avströning" i stället för "Inmatning 2".
  return { id: nextId("gren"), name: "", fromNodeId, toNodeId };
}

/**
 * Delar en sträcka vid en maskin, så att något kan mynna in där.
 *
 * En andra inmatning som möter linjen mitt i den behöver en punkt att möta
 * den i. Punkten finns inte förrän någon ritar dit en pil, och då skapas den:
 * sträckan klipps vid maskinen, och maskinerna efter den flyttas till
 * fortsättningen. Ingen maskin byter plats i hallen av det — bara vilken
 * sträcka de står på.
 */
export function splitEdge(
  graph: FlowGraph,
  line: LineItem[],
  instanceId: string,
  at: Vec2,
  where: "before" | "after",
): { graph: FlowGraph; line: LineItem[]; nodeId: string } | null {
  const item = line.find((i) => i.instanceId === instanceId);
  const edge = item?.edgeId
    ? graph.edges.find((e) => e.id === item.edgeId)
    : orderedEdges(graph)[0];
  if (!edge) return null;

  const onEdge = line.filter((i) => (i.edgeId ?? orderedEdges(graph)[0]?.id) === edge.id);
  const index = onEdge.findIndex((i) => i.instanceId === instanceId);
  if (index < 0) return null;

  // Ligger maskinen redan i änden finns punkten: sträckans egen nod.
  if (where === "before" && index === 0) return { graph, line, nodeId: edge.fromNodeId };
  if (where === "after" && index === onEdge.length - 1 && edge.toNodeId) {
    return { graph, line, nodeId: edge.toNodeId };
  }

  const junction = makeNode(graph, "junction", at);
  const rest = makeEdge(graph, junction.id, edge.toNodeId);
  const moved = new Set(
    onEdge.slice(where === "before" ? index : index + 1).map((i) => i.instanceId),
  );

  return {
    graph: {
      nodes: [...graph.nodes, junction],
      edges: [
        ...graph.edges.map((e) => (e.id === edge.id ? { ...e, toNodeId: junction.id } : e)),
        rest,
      ],
    },
    line: line.map((i) => (moved.has(i.instanceId) ? { ...i, edgeId: rest.id } : i)),
    nodeId: junction.id,
  };
}

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };

/** Grafen med en nod borttagen, och sträckorna som hängde i den. */
export function removeNode(graph: FlowGraph, nodeId: string): FlowGraph {
  return {
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
  };
}
