import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { solveLayout } from "@/lib/solver";
import {
  edgeItems,
  edgeItemsWithFallback,
  edgeDirection,
  edgeLabel,
  edgeOrder,
  edgeRole,
  makeEdge,
  makeNode,
  nodeNear,
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

  // En i taget, som i gränssnittet: namnen numreras mot grafen som den ser ut.
  const nod = (kind: "infeed" | "junction" | "outfeed", at: Vec2, dir: "x+" | "y+" = "x+") => {
    const node = makeNode(graph, kind, at, dir);
    graph.nodes.push(node);
    return node;
  };

  const in1 = nod("infeed", { x: 2000, y: 6000 });
  const in2 = nod("infeed", { x: 2000, y: 16000 });
  const möte = nod("junction", { x: 20000, y: 6000 });
  const delning = nod("junction", { x: 34000, y: 6000 });
  const ut1 = nod("outfeed", { x: 42000, y: 6000 });
  const ut2 = nod("outfeed", { x: 34000, y: 16000 }, "y+");

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

  it("låter båda inmatningarna sluta i mötet de ritades mot", () => {
    const graph = config.flowGraph!;
    const möte = graph.nodes.find((n) => n.name === "Korsning 1")!;

    // En inmatning ska nå fram till mötespunkten, inte börja i den och
    // fortsätta förbi: sista utporten är den som ska ligga där.
    for (const edge of graph.edges.filter((e) => e.toNodeId === möte.id)) {
      const run = solved.edgeRuns.find((r) => r.edgeId === edge.id)!;
      expect(run.end).not.toBeNull();
      expect(run.gapMm).toBeLessThanOrEqual(1);
    }
  });

  it("lägger inte två inmatningar på varandra när den andra kommer uppifrån", () => {
    /*
     * Så ser skissen ut: den andra vägen in kommer ned genom kedjekanaler och
     * möter banan i rät vinkel, en bit längre fram. Två vägar som båda ritats
     * längs samma riktning mot samma punkt hamnar däremot på varandra — och
     * ska göra det, för det är vad de betyder.
     */
    const { config: eget, graph } = tvågrenatFlöde();
    const in2 = graph.nodes.find((n) => n.name === "Inport 2")!;
    const andraMötet = makeNode(graph, "junction", { x: 26000, y: 6000 });
    graph.nodes.push(andraMötet);
    in2.at = { x: 26000, y: 17000 };
    graph.edges[1] = { ...graph.edges[1], toNodeId: andraMötet.id };
    graph.edges.push(makeEdge(graph, andraMötet.id, graph.edges[2].toNodeId));

    const lösning = solveLayout(eget, library);
    const [a, b] = lösning.placements;
    expect(Math.abs(a.bbox.x - b.bbox.x) + Math.abs(a.bbox.y - b.bbox.y)).toBeGreaterThan(3000);
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

  it("erbjuder att kapa banan till ritningen när någon stängt av det", () => {
    const { config, graph } = tvågrenatFlöde();
    // Den gemensamma banan fortsätter efter mötet och är fastkopplad i sin
    // början — den kan bara kapas, inte flyttas. Med kapningen avstängd ska
    // glappet rapporteras med åtgärden att slå på den igen.
    graph.nodes.find((n) => n.name === "Korsning 2")!.at = { x: 44000, y: 6000 };
    graph.edges[2] = { ...graph.edges[2], fit: false };

    const fix = computeLayout(config, library)
      .diagnostics.filter((d) => d.code === "R-701")
      .map((d) => d.fix)
      .find((f) => f?.kind === "fitEdge");

    expect(fix?.label).toMatch(/^Kapa /);
  });

  it("kapar banan till den ritade sträckan utan att någon ber om det", () => {
    const { config, graph } = tvågrenatFlöde();
    graph.nodes.find((n) => n.name === "Korsning 2")!.at = { x: 30000, y: 6000 };

    const run = solveLayout(config, library).edgeRuns.find((r) => r.edgeId === graph.edges[2].id)!;
    expect(run.gapMm).toBeLessThanOrEqual(1);
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

describe("maskinerna följer pilen", () => {
  /** En ensam gren mellan två punkter, med några transportörer på. */
  function gren(från: Vec2, till: Vec2): Configuration {
    const graph: FlowGraph = { nodes: [], edges: [] };
    const a = makeNode(graph, "infeed", från, "x+");
    const b = makeNode(graph, "outfeed", till);
    graph.nodes.push(a, b);
    const edge = makeEdge(graph, a.id, b.id);
    graph.edges.push(edge);

    return {
      ...defaultConfig(),
      line: [item("rullbana", edge.id), item("rullbana", edge.id)],
      flowGraph: graph,
    };
  }

  it("går nedåt när pilen ritats nedåt", () => {
    const config = gren({ x: 10000, y: 3000 }, { x: 10000, y: 20000 });
    const [första, andra] = solveLayout(config, library).placements;

    // Andra maskinen ska ligga längre ned i hallen, inte längre åt höger.
    expect(andra.bbox.y).toBeGreaterThan(första.bbox.y + 1000);
    expect(Math.abs(andra.bbox.x - första.bbox.x)).toBeLessThan(2000);
  });

  it("går åt vänster när pilen ritats åt vänster", () => {
    const config = gren({ x: 40000, y: 11000 }, { x: 8000, y: 11000 });
    const [första, andra] = solveLayout(config, library).placements;

    expect(andra.bbox.x).toBeLessThan(första.bbox.x - 1000);
  });

  it("läser riktningen ur grafen, inte ur nodens fält", () => {
    const config = gren({ x: 10000, y: 20000 }, { x: 10000, y: 3000 });
    const graph = config.flowGraph!;
    // Noden säger x+ eftersom det är utgångsvärdet; pilen säger uppåt.
    expect(graph.nodes[0].dir).toBe("x+");
    expect(edgeDirection(graph, graph.edges[0])).toBe("y-");
  });
});

describe("pilar som möts fäster i varandra", () => {
  it("fäster i en nod som redan finns i stället för att lägga en ny bredvid", () => {
    const graph: FlowGraph = { nodes: [], edges: [] };
    const mål = makeNode(graph, "junction", { x: 20000, y: 11000 });
    graph.nodes.push(mål);

    // Nästan på pricken — så nära ingen siktar med flit.
    expect(nodeNear(graph, { x: 20400, y: 11300 })?.id).toBe(mål.id);
    // Och en bit bort ska den inte fästa.
    expect(nodeNear(graph, { x: 26000, y: 11000 })).toBeNull();
  });
});
