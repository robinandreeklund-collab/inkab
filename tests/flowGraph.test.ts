import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { solveLayout } from "@/lib/solver";
import {
  edgeItems,
  edgeItemsWithFallback,
  edgeLabel,
  edgeOrder,
  edgeRole,
  makeEdge,
  makeNode,
  orderedEdges,
  removeNode,
  splitEdge,
} from "@/lib/flowGraph";
import { BUILTIN_MACHINES, makeLibrary } from "@/lib/library";
import { configurationSchema } from "@/lib/schema";
import { defaultConfig } from "@/lib/templates";
import type { Configuration, FlowGraph, LineItem, Vec2 } from "@/lib/types";

/**
 * Flödet som kunden ritar.
 *
 * Det som inte gick förut var sammanslagningen: två inmatningar som möts på
 * en gemensam bana. Trädet hade en rot och varje maskin en föregångare, så
 * det fanns ingen plats att uttrycka mötet. Skelettet har det, och testerna
 * håller fast vid att båda vägarna faktiskt hamnar i hallen.
 */

const library = makeLibrary(BUILTIN_MACHINES);

let n = 0;
const item = (machineId: string, edgeId: string): LineItem => {
  n += 1;
  return { instanceId: `${machineId}-${n}`, machineId, edgeId, selectedOptions: [] };
};

/** Två inportar → gemensam bana → delning → två utportar. */
function tvågrenatFlöde(): { config: Configuration; graph: FlowGraph } {
  const graph: FlowGraph = { nodes: [], edges: [] };

  const in1 = makeNode(graph, "infeed", { x: 2000, y: 6000 }, "x+");
  const in2 = makeNode(graph, "infeed", { x: 2000, y: 16000 }, "x+");
  graph.nodes.push(in1, in2);

  const möte = makeNode(graph, "junction", { x: 20000, y: 6000 }, "x+");
  const delning = makeNode(graph, "junction", { x: 34000, y: 6000 }, "x+");
  const ut1 = makeNode(graph, "outfeed", { x: 42000, y: 6000 }, "x+");
  const ut2 = makeNode(graph, "outfeed", { x: 34000, y: 16000 }, "y+");
  graph.nodes.push(möte, delning, ut1, ut2);

  // En i taget, som i gränssnittet: namnet kommer ur grafen som den ser ut nu.
  const add = (from: string, to: string) => {
    const edge = makeEdge(graph, from, to);
    graph.edges.push(edge);
    return edge;
  };
  const gren1 = add(in1.id, möte.id);
  const gren2 = add(in2.id, möte.id);
  const gemensam = add(möte.id, delning.id);
  const utA = add(delning.id, ut1.id);
  const utB = add(delning.id, ut2.id);

  const config: Configuration = {
    ...defaultConfig(),
    line: [
      item("rullbana", gren1.id),
      item("rullbana", gren2.id),
      item("kedjetransportor", gemensam.id),
      item("bandomforing", gemensam.id),
      item("paketlyft-fast", utA.id),
      item("rullbana", utB.id),
    ],
    flowGraph: graph,
  };

  return { config, graph };
}

describe("ordningen sträckorna löses i", () => {
  it("matar en korsning innan den byggs vidare från", () => {
    const { graph } = tvågrenatFlöde();
    const order = orderedEdges(graph).map((e) => e.id);
    const id = (n: number) => graph.edges[n].id;

    // De två inmatningarna matar korsningen; den gemensamma banan kan inte
    // placeras före dem, och utmatningarna inte före den gemensamma.
    expect(order.indexOf(id(2))).toBeGreaterThan(order.indexOf(id(0)));
    expect(order.indexOf(id(3))).toBeGreaterThan(order.indexOf(id(2)));
    expect(order).toHaveLength(5);
  });

  it("rapporterar sträckor som ligger i en ring i stället för att tappa dem", () => {
    const graph: FlowGraph = { nodes: [], edges: [] };
    const a = makeNode(graph, "junction", { x: 0, y: 0 });
    const b = makeNode(graph, "junction", { x: 10000, y: 0 });
    graph.nodes.push(a, b);
    graph.edges.push(makeEdge(graph, a.id, b.id), makeEdge(graph, b.id, a.id));

    const { order, cyclic } = edgeOrder(graph);
    expect(order).toEqual([]);
    expect(cyclic).toHaveLength(2);
  });
});

describe("två inmatningar mot en gemensam bana", () => {
  const { config } = tvågrenatFlöde();
  const solved = solveLayout(config, library);

  it("placerar alla maskiner, på båda inmatningarna", () => {
    expect(solved.unplaced).toEqual([]);
    expect(solved.placements.filter((p) => !p.aux)).toHaveLength(6);
  });

  it("låter de två inmatningarna börja där de ritades", () => {
    const [första, andra] = solved.placements;
    // Grenarna utgår från var sin nod, alltså på olika höjd i hallen.
    expect(Math.abs(första.bbox.y - andra.bbox.y)).toBeGreaterThan(5000);
  });

  it("mäter glappet mellan varje sträcka och den ritade noden", () => {
    for (const run of solved.edgeRuns) {
      expect(run.gapMm).not.toBeNull();
      expect(Number.isFinite(run.gapMm!)).toBe(true);
    }
    expect(solved.edgeRuns).toHaveLength(5);
  });

  it("bygger delningen ur samma nod, åt två håll", () => {
    const runs = solved.edgeRuns;
    const utA = runs[3];
    const utB = runs[4];
    expect(utA.count).toBe(1);
    expect(utB.count).toBe(1);
  });

  it("går igenom serverns schema", () => {
    expect(configurationSchema.safeParse(config).success).toBe(true);
  });

  it("ger diagnostik utan att haverera", () => {
    const layout = computeLayout(config, library);
    expect(layout.placements.length).toBeGreaterThan(0);
    expect(Array.isArray(layout.diagnostics)).toBe(true);
  });
});

describe("reglerna för skelettet", () => {
  it("säger till när en gren inte når fram till sin nod", () => {
    const { config, graph } = tvågrenatFlöde();
    // Flytta korsningen långt bort från där maskinerna faktiskt slutar.
    const möte = graph.nodes.find((n) => n.kind === "junction")!;
    möte.at = { x: 40000, y: 6000 };

    const diagnostics = computeLayout(config, library).diagnostics;
    const glapp = diagnostics.filter((d) => d.code === "R-701");

    expect(glapp.length).toBeGreaterThan(0);
    expect(glapp[0].detail).toMatch(/m från den ritade punkten/);
  });

  it("erbjuder att sträcka banan när det finns en kapbar maskin", () => {
    const { config, graph } = tvågrenatFlöde();
    graph.nodes.find((n) => n.kind === "junction")!.at = { x: 40000, y: 6000 };

    const fix = computeLayout(config, library)
      .diagnostics.filter((d) => d.code === "R-701")
      .map((d) => d.fix)
      .find((f) => f?.kind === "fitEdge");

    expect(fix).toBeTruthy();
    expect(fix?.label).toMatch(/^Sträck Inmatning /);
  });

  it("sträcker banan när grenen är satt att nå fram", () => {
    const { config, graph } = tvågrenatFlöde();
    const möte = graph.nodes.find((n) => n.kind === "junction")!;
    möte.at = { x: 30000, y: 6000 };
    graph.edges[0].fit = true;

    const run = solveLayout(config, library).edgeRuns.find((r) => r.edgeId === graph.edges[0].id)!;
    expect(run.gapMm).toBeLessThanOrEqual(500);
  });

  it("varnar när två inmatningar lämnar mer än mottagaren klarar", () => {
    const { config, graph } = tvågrenatFlöde();
    const diagnostics = computeLayout(config, library).diagnostics;
    const möte = graph.nodes.find((n) => n.kind === "junction")!;

    // Rullbanorna lämnar 30 paket/h var; kedjetransportören klarar 32.
    const kapacitet = diagnostics.find((d) => d.code === "R-702");
    expect(kapacitet?.title).toContain(möte.name);
    expect(kapacitet?.detail).toMatch(/paket\/h/);
  });

  it("säger till om en tom gren", () => {
    const { config, graph } = tvågrenatFlöde();
    const tom = makeEdge(graph, graph.nodes[0].id, null);
    graph.edges.push(tom);

    const diagnostics = computeLayout(config, library).diagnostics;
    expect(diagnostics.some((d) => d.code === "R-704")).toBe(true);
  });

  it("säger till när flödet går i en ring", () => {
    const config = defaultConfig();
    const graph: FlowGraph = { nodes: [], edges: [] };
    const a = makeNode(graph, "junction", { x: 5000, y: 5000 });
    const b = makeNode(graph, "junction", { x: 15000, y: 5000 });
    graph.nodes.push(a, b);
    graph.edges.push(makeEdge(graph, a.id, b.id));
    graph.edges.push(makeEdge(graph, b.id, a.id));

    const ring = computeLayout({ ...config, line: [], flowGraph: graph }, library).diagnostics.find(
      (d) => d.code === "R-705",
    );
    expect(ring?.severity).toBe("error");
  });
});

describe("skelettet rör inte den som inte ritat något", () => {
  it("löser en vanlig linje precis som förut", () => {
    const utan = defaultConfig();
    const med: Configuration = { ...utan, flowGraph: { nodes: [], edges: [] } };

    const a = solveLayout(utan, library);
    const b = solveLayout(med, library);

    expect(b.placements.map((p) => p.bbox)).toEqual(a.placements.map((p) => p.bbox));
    expect(b.edgeRuns).toEqual([]);
  });
});

describe("grafens hushållning", () => {
  it("tar bort sträckorna som hängde i en borttagen nod", () => {
    const { graph } = tvågrenatFlöde();
    const möte = graph.nodes.find((node) => node.name === "Korsning 1")!;
    const kvar = removeNode(graph, möte.id);

    expect(kvar.nodes.some((node) => node.id === möte.id)).toBe(false);
    expect(kvar.edges.some((e) => e.fromNodeId === möte.id || e.toNodeId === möte.id)).toBe(false);
  });

  it("plockar maskinerna som står på en gren, i listans ordning", () => {
    const { config, graph } = tvågrenatFlöde();
    const gemensam = graph.edges[2];
    expect(edgeItems(config.line, gemensam.id).map((i) => i.machineId)).toEqual([
      "kedjetransportor",
      "bandomforing",
    ]);
  });
});

describe("linjen som fanns innan flödet ritades", () => {
  it("hör till den första grenen, både i solvern och i listan", () => {
    const config = defaultConfig();
    const graph: FlowGraph = { nodes: [], edges: [] };
    const start = makeNode(graph, "infeed", { x: 2000, y: 11000 }, "x+");
    const slut = makeNode(graph, "outfeed", { x: 40000, y: 11000 }, "x+");
    graph.nodes.push(start, slut);
    const gren = makeEdge(graph, start.id, slut.id);
    graph.edges.push(gren);

    // Maskinerna saknar gren — de byggdes innan skelettet fanns.
    const med: Configuration = { ...config, flowGraph: graph };
    expect(med.line.every((i) => !i.edgeId)).toBe(true);

    const solved = solveLayout(med, library);
    expect(solved.unplaced).toEqual([]);
    expect(solved.placements.filter((p) => !p.aux).length).toBeGreaterThan(0);

    // Listan och solvern måste räkna samma maskiner till grenen.
    expect(edgeItemsWithFallback(med.line, graph, gren.id)).toHaveLength(med.line.length);
    expect(solved.edgeRuns[0].count).toBe(
      solved.placements.filter((p) => !p.aux).length,
    );
  });
});

describe("en pil är en gren", () => {
  /** Samma sak som store-lagret gör när en pil dras, utan React. */
  function drawArrow(
    config: Configuration,
    from: { at: Vec2 } | { instanceId: string; at: Vec2 },
    to: { at: Vec2 } | { instanceId: string; at: Vec2 },
  ) {
    let graph: FlowGraph = JSON.parse(JSON.stringify(config.flowGraph ?? { nodes: [], edges: [] }));
    let line: LineItem[] = JSON.parse(JSON.stringify(config.line));

    const anchor = (side: typeof from, where: "before" | "after") => {
      if (!("instanceId" in side)) {
        const node = makeNode(graph, "junction", side.at);
        graph.nodes.push(node);
        return node.id;
      }
      const split = splitEdge(graph, line, side.instanceId, side.at, where);
      if (!split) return null;
      graph = split.graph;
      line = split.line;
      return split.nodeId;
    };

    const fromId = anchor(from, "after");
    const toId = anchor(to, "before");
    if (!fromId || !toId) throw new Error("kunde inte fästa pilen");
    const edge = makeEdge(graph, fromId, toId);
    graph.edges.push(edge);
    return { config: { ...config, flowGraph: graph, line }, edgeId: edge.id };
  }

  /** En linje med ett skelett: en inmatning, en utmatning, allt på spinen. */
  function enkelLinje(): Configuration {
    const graph: FlowGraph = { nodes: [], edges: [] };
    const start = makeNode(graph, "infeed", { x: 2000, y: 11000 }, "x+");
    const slut = makeNode(graph, "outfeed", { x: 40000, y: 11000 });
    graph.nodes.push(start, slut);
    const spine = makeEdge(graph, start.id, slut.id);
    graph.edges.push(spine);

    const base = defaultConfig();
    return {
      ...base,
      flowGraph: graph,
      line: base.line.map((i) => ({ ...i, edgeId: spine.id })),
    };
  }

  it("drar man från golvet till en maskin blir det en inmatning dit", () => {
    const före = enkelLinje();
    const mitten = före.line[2];

    const { config, edgeId } = drawArrow(
      före,
      { at: { x: 6000, y: 22000 } },
      { instanceId: mitten.instanceId, at: { x: 16000, y: 11000 } },
    );

    const graph = config.flowGraph!;
    const ny = graph.edges.find((e) => e.id === edgeId)!;

    // Den nya grenen är en inmatning: inget mynnar i dess startnod.
    expect(edgeRole(graph, ny)).toBe("infeed");
    expect(edgeLabel(graph, ny)).toMatch(/^Inmatning/);

    // Linjen klipptes vid maskinen, och maskinerna efter den flyttade med.
    expect(graph.edges).toHaveLength(3);
    const efter = config.line.slice(2).map((i) => i.edgeId);
    expect(new Set(efter).size).toBe(1);
    expect(efter[0]).not.toBe(config.line[0].edgeId);

    // Och allt går fortfarande att placera.
    const solved = solveLayout(config, library);
    expect(solved.unplaced).toEqual([]);
  });

  it("drar man från en maskin ut på golvet blir det en väg ut därifrån", () => {
    const före = enkelLinje();
    const mitten = före.line[2];

    const { config, edgeId } = drawArrow(
      före,
      { instanceId: mitten.instanceId, at: { x: 16000, y: 11000 } },
      { at: { x: 16000, y: 21000 } },
    );

    const graph = config.flowGraph!;
    const ny = graph.edges.find((e) => e.id === edgeId)!;
    expect(edgeRole(graph, ny)).toBe("outfeed");
    expect(edgeLabel(graph, ny)).toMatch(/^Utmatning/);
    expect(solveLayout(config, library).unplaced).toEqual([]);
  });

  it("namnen kommer ur formen, inte ur en räknare", () => {
    let config = enkelLinje();
    const mål = config.line[1];

    config = drawArrow(config, { at: { x: 4000, y: 20000 } }, { instanceId: mål.instanceId, at: { x: 9000, y: 11000 } }).config;
    config = drawArrow(config, { at: { x: 4000, y: 2000 } }, { instanceId: mål.instanceId, at: { x: 9000, y: 11000 } }).config;

    const graph = config.flowGraph!;
    const inmatningar = graph.edges
      .filter((e) => edgeRole(graph, e) === "infeed")
      .map((e) => edgeLabel(graph, e));

    // Tre vägar in: den ursprungliga och de två ritade.
    expect(inmatningar).toEqual(["Inmatning 1", "Inmatning 2", "Inmatning 3"]);
  });
});
