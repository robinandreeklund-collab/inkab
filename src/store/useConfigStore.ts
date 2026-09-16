"use client";

import { create } from "zustand";
import { computeLayout } from "@/lib/layout";
import { BUILTIN_LIBRARY, getMachine, makeLibrary, type MachineLibrary } from "@/lib/library";
import { defaultConfig, lineItem } from "@/lib/templates";
import { removeWithBranches, segmentEndIndex } from "@/lib/branches";
import {
  EMPTY_GRAPH,
  makeEdge,
  makeNode,
  nodeNear,
  orderedEdges,
  removeNode,
  splitEdge,
} from "@/lib/flowGraph";
import { describeChange, logEntry, LOG_LIMIT, type LogEntry, type LogKind } from "@/lib/projectLog";
import type {
  ConfigPatch,
  Configuration,
  Dir,
  DrawnObject,
  Flow,
  FlowEdge,
  FlowGraph,
  FlowNode,
  LayoutResult,
  Machine,
  ParameterValue,
  Vec2,
} from "@/lib/types";

const HISTORY_LIMIT = 60;
const STORAGE_KEY = "inkab.config.v1";
/**
 * Utkastet som låg här när en delningslänk öppnades. En länk skriver över
 * det som fanns, och utan den här nyckeln vore det arbetet borta utan att
 * någon frågat. Bannern erbjuder att gå tillbaka.
 */
const RESCUE_KEY = "inkab.config.before-share";
/** Projektets logg. Ligger vid sidan av konfigurationen, se lib/projectLog.ts. */
const LOG_KEY = "inkab.log.v1";

export type Tool = "select" | "wall" | "door" | "truck" | "nogo" | "measure" | "flow";
export type ViewMode = "2d" | "3d" | "model";
export type Unit = "m" | "mm";

type Screen = "onboarding" | "configurator" | "quote";

/**
 * Vad som hände när sidan öppnades med en delningslänk. Null betyder att
 * ingen länk var med — inte att allt gick bra.
 */
/** Var en ritad pil fäster: på golvet, eller vid en maskin. */
export type FlowAnchor =
  | { kind: "point"; at: Vec2 }
  | { kind: "machine"; instanceId: string; at: Vec2 };

export type ShareNotice =
  | { kind: "loaded"; reference: string; hadLocalDraft: boolean }
  | { kind: "unreadable" }
  | { kind: "invalid" };

type State = {
  config: Configuration;
  layout: LayoutResult;
  /** Aktivt maskinbibliotek, hämtat från servern så att admins ändringar slår igenom. */
  library: MachineLibrary;
  libraryLoaded: boolean;
  past: Configuration[];
  future: Configuration[];

  screen: Screen;
  view: ViewMode;
  unit: Unit;
  tool: Tool;
  selectedId: string | null;
  inspectorOpen: boolean;
  aiOpen: boolean;
  diagnosticsOpen: boolean;
  showZones: boolean;
  showPorts: boolean;
  hydrated: boolean;
  shareNotice: ShareNotice | null;
  /** Vad som hänt i projektet, äldst först. */
  log: LogEntry[];
  /**
   * Offerten som är öppnad, när en är det.
   *
   * Priset räknas på servern med just den offertens rabatt, och att spara
   * skriver tillbaka till samma rad i stället för att lägga en kopia bredvid.
   */
  proposalId: string | null;
  /**
   * Utgången nästa maskin ska hängas på. Satt när någon tryckt "bygg vidare
   * härifrån" på en ledig utgång; nästa maskin ur katalogen startar då en
   * gren i stället för att läggas sist.
   */
  branchTarget: { instanceId: string; outPortId: string } | null;
  /**
   * Grenen nya maskiner hamnar på. Satt genom att markera en sträcka i
   * ritningen eller i linjeremsan. Utan markering hamnar de på den första
   * grenen, som är den maskinerna annars hade legat i.
   */
  selectedEdgeId: string | null;
};

type Actions = {
  setScreen: (s: Screen) => void;
  setView: (v: ViewMode) => void;
  setUnit: (u: Unit) => void;
  setTool: (t: Tool) => void;
  select: (id: string | null) => void;
  toggleInspector: () => void;
  toggleAi: (open?: boolean) => void;
  toggleDiagnostics: (open?: boolean) => void;
  toggleZones: () => void;
  togglePorts: () => void;

  setLibrary: (machines: Machine[]) => void;
  /** Skriver en rad i projektloggen. */
  note: (kind: LogKind, text: string, detail?: string) => void;
  setLog: (entries: LogEntry[]) => void;
  setProposalId: (id: string | null) => void;
  clearLog: () => void;
  load: (config: Configuration, options?: { resetHistory?: boolean; note?: string }) => void;
  update: (recipe: (draft: Configuration) => void) => void;
  setFlow: (patch: Partial<Flow>) => void;
  setFlowPoint: (which: "startPoint" | "endPoint", point: Vec2 | null) => void;
  addMachine: (machineId: string, atIndex?: number) => void;
  removeItem: (instanceId: string) => void;
  moveItem: (instanceId: string, toIndex: number) => void;
  toggleOption: (instanceId: string, optionId: string) => void;
  setVariant: (instanceId: string, variantId: string) => void;
  setBranchTarget: (target: { instanceId: string; outPortId: string } | null) => void;
  setOutPort: (instanceId: string, outPortId: string) => void;
  setParameter: (instanceId: string, parameterId: string, value: ParameterValue) => void;
  nudge: (instanceId: string, delta: Vec2) => void;
  resetOffset: (instanceId: string) => void;
  /* ── Flödesskelettet ──────────────────────────────────────────────── */
  /**
   * Ritar en pil i flödet. Pilens riktning är paketens riktning, och vad den
   * betyder avgörs av vad den rör: golv → maskin är en inmatning dit, maskin
   * → golv en väg ut därifrån.
   */
  drawFlowArrow: (from: FlowAnchor, to: FlowAnchor) => string | null;
  /** Lägger en nod och returnerar dess id. */
  addFlowNode: (kind: FlowNode["kind"], at: Vec2, dir?: Dir) => string;
  /** Drar en sträcka mellan två noder. */
  connectFlow: (fromNodeId: string, toNodeId: string | null) => string | null;
  moveFlowNode: (id: string, at: Vec2) => void;
  updateFlowNode: (id: string, patch: Partial<Omit<FlowNode, "id">>) => void;
  updateFlowEdge: (id: string, patch: Partial<Omit<FlowEdge, "id">>) => void;
  removeFlowNode: (id: string) => void;
  removeFlowEdge: (id: string) => void;
  selectEdge: (id: string | null) => void;
  /** Rensar hela skelettet och lämnar maskinerna i en vanlig linje. */
  clearFlowGraph: () => void;

  addDrawn: (obj: DrawnObject) => void;
  updateDrawn: (id: string, patch: Partial<DrawnObject>) => void;
  removeDrawn: (id: string) => void;
  clearDrawn: () => void;
  applyPatch: (patch: ConfigPatch) => void;

  dismissShareNotice: () => void;
  /** Går tillbaka till utkastet som delningslänken skrev över. */
  restorePreviousDraft: () => boolean;

  undo: () => void;
  redo: () => void;
  hydrate: () => void;
};

/** Djupkopia utan beroenden; konfigurationen är ren JSON. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** Autosparat utkast, eller null om det saknas eller är obrukbart. */
function readLocalDraft(): Configuration | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Configuration;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function persist(config: Configuration) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Privat läge eller full kvot — autospar är en bekvämlighet, inte ett krav.
  }
}

function persistLog(log: LogEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* samma sak: loggen är ett underlag, inte ett krav för att arbeta */
  }
}

function readLog(): LogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as LogEntry[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-LOG_LIMIT) : [];
  } catch {
    return [];
  }
}

export const useConfigStore = create<State & Actions>((set, get) => {
  const initial = defaultConfig();

  /**
   * Skriver en rad utan att röra ångra-historiken. Loggen är inte en del av
   * konfigurationen: att ta tillbaka en ändring är också något som hände.
   */
  const note = (entry: LogEntry) => {
    const log = [...get().log, entry].slice(-LOG_LIMIT);
    set({ log });
    persistLog(log);
  };

  const commit = (next: Configuration) => {
    const { config, past, library } = get();
    set({
      config: next,
      layout: computeLayout(next, library),
      past: [...past, config].slice(-HISTORY_LIMIT),
      future: [],
    });
    persist(next);

    // Loggen skrivs där konfigurationen byts ut, inte i varje knapp: då kan
    // ingen ny knapp glömma bort att skriva sin rad.
    const changed = describeChange(config, next, (machineId) =>
      getMachine(machineId, library)?.name ?? machineId,
    );
    if (changed) note(changed);
  };

  return {
    config: initial,
    layout: computeLayout(initial),
    library: BUILTIN_LIBRARY,
    libraryLoaded: false,
    past: [],
    future: [],

    screen: "onboarding",
    view: "2d",
    unit: "m",
    tool: "select",
    selectedId: null,
    /*
     * Infälld tills något är markerat. Inspektorn visar en markering, och en
     * tom panel som tar en fjärdedel av skärmen säger ingenting — ritytan är
     * mer värd innan man valt något.
     */
    inspectorOpen: false,
    aiOpen: false,
    diagnosticsOpen: false,
    showZones: true,
    showPorts: false,
    hydrated: false,
    shareNotice: null,
    log: [],
    proposalId: null,
    branchTarget: null,
    selectedEdgeId: null,

    setScreen: (screen) => set({ screen }),
    setView: (view) => set({ view }),
    setUnit: (unit) => set({ unit }),
    setTool: (tool) => set({ tool }),
    select: (selectedId) =>
      // Att markera något är att vilja se det. Panelen fälls ut av sig själv
      // och kan fällas ihop igen; nästa markering öppnar den på nytt.
      set((state) => ({
        selectedId,
        inspectorOpen: selectedId ? true : state.inspectorOpen,
      })),
    toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
    toggleAi: (open) => set((s) => ({ aiOpen: open ?? !s.aiOpen })),
    toggleDiagnostics: (open) => set((s) => ({ diagnosticsOpen: open ?? !s.diagnosticsOpen })),
    toggleZones: () => set((s) => ({ showZones: !s.showZones })),
    togglePorts: () => set((s) => ({ showPorts: !s.showPorts })),

    note: (kind, text, detail) => note(logEntry(kind, text, detail)),
    setProposalId: (proposalId) => set({ proposalId }),
    setLog: (entries) => {
      const log = entries.slice(-LOG_LIMIT);
      set({ log });
      persistLog(log);
    },
    clearLog: () => {
      set({ log: [] });
      persistLog([]);
    },

    setLibrary: (machines) => {
      const library = makeLibrary(machines);
      set({ library, libraryLoaded: true, layout: computeLayout(get().config, library) });
    },

    load: (config, options) => {
      const next = clone(config);
      if (options?.resetHistory) {
        set({
          config: next,
          layout: computeLayout(next, get().library),
          past: [],
          future: [],
          selectedId: null,
        });
        persist(next);
        if (options.note) note(logEntry("start", options.note));
      } else {
        commit(next);
        if (options?.note) note(logEntry("proposal", options.note));
      }
    },

    update: (recipe) => {
      const next = clone(get().config);
      recipe(next);
      commit(next);
    },

    setFlow: (patch) => get().update((d) => Object.assign(d.flow, patch)),

    setFlowPoint: (which, point) =>
      get().update((d) => {
        if (which === "startPoint") {
          if (point) d.flow.startPoint = point;
        } else {
          d.flow.endPoint = point;
        }
      }),

    addMachine: (machineId, atIndex) => {
      const machine = getMachine(machineId, get().library);
      if (!machine) return;
      // Hjälpobjekt är unika: en linje har en pulpet och ett ströfacksmagasin.
      if (machine.aux && get().config.line.some((i) => i.machineId === machineId)) {
        const existing = get().config.line.find((i) => i.machineId === machineId)!;
        get().select(existing.instanceId);
        return;
      }
      // Utförandet skrivs in vid tillägget i stället för att lämnas tomt:
      // ändrar admin ordningen på utförandena ska en sparad konfiguration
      // inte tyst byta maskin.
      const item = lineItem(machineId);
      if (machine.variants?.length) item.variantId = machine.variants[0].id;

      /*
       * Var maskinen hamnar: på den utpekade utgången om någon är vald, annars
       * sist i samma gren som den markerade maskinen. Utan markering sist i
       * listan, som förut.
       */
      const target = get().branchTarget;
      if (target) item.branch = { fromInstanceId: target.instanceId, outPortId: target.outPortId };

      /*
       * Är flödet ritat hör maskinen till en gren, inte till en position i
       * listan. Den markerade grenen gäller; utan markering den första, som
       * är den maskinerna annars hade hamnat i.
       */
      const graph = get().config.flowGraph;
      if (graph && graph.edges.length > 0) {
        // Markerad gren först, annars grenen den markerade maskinen står på,
        // annars den första — den som är huvudlinjen i det ritade flödet.
        const beside = get().config.line.find((i) => i.instanceId === get().selectedId);
        item.edgeId =
          get().selectedEdgeId ?? beside?.edgeId ?? orderedEdges(graph)[0]?.id ?? graph.edges[0].id;
      }

      const fallback = target
        ? segmentEndIndex(get().config.line, target.instanceId)
        : segmentEndIndex(get().config.line, get().selectedId);

      get().update((d) => {
        const index = atIndex ?? fallback;
        d.line.splice(Math.max(0, Math.min(d.line.length, index)), 0, item);
      });
      set({ branchTarget: null });
      get().select(item.instanceId);
    },

    removeItem: (instanceId) => {
      get().update((d) => {
        // Grenar som hänger på maskinen följer med: en gren utan fäste går
        // inte att placera, och att lämna kvar den vore att lämna maskiner
        // som varken kan ritas eller hittas.
        d.line = removeWithBranches(d.line, instanceId);
      });
      if (get().selectedId === instanceId) set({ selectedId: null });
    },

    moveItem: (instanceId, toIndex) =>
      get().update((d) => {
        const from = d.line.findIndex((i) => i.instanceId === instanceId);
        if (from < 0) return;
        const [item] = d.line.splice(from, 1);
        d.line.splice(Math.max(0, Math.min(d.line.length, toIndex)), 0, item);
      }),

    setBranchTarget: (branchTarget) => set({ branchTarget }),

    setVariant: (instanceId, variantId) =>
      get().update((d) => {
        const item = d.line.find((i) => i.instanceId === instanceId);
        if (!item) return;
        item.variantId = variantId;
        // Manuell förskjutning hör ihop med det gamla måttet. Ett nytt
        // utförande är en annan maskin i geometrin, så justeringen släpps.
        delete item.manualOffset;
      }),

    setOutPort: (instanceId, outPortId) =>
      get().update((d) => {
        const item = d.line.find((i) => i.instanceId === instanceId);
        if (item) item.outPortId = outPortId;
      }),

    setParameter: (instanceId, parameterId, value) =>
      get().update((d) => {
        const item = d.line.find((i) => i.instanceId === instanceId);
        if (!item) return;
        item.parameters = { ...(item.parameters ?? {}), [parameterId]: value };
      }),

    toggleOption: (instanceId, optionId) =>
      get().update((d) => {
        const item = d.line.find((i) => i.instanceId === instanceId);
        if (!item) return;
        item.selectedOptions = item.selectedOptions.includes(optionId)
          ? item.selectedOptions.filter((o) => o !== optionId)
          : [...item.selectedOptions, optionId];
      }),

    nudge: (instanceId, delta) =>
      get().update((d) => {
        const item = d.line.find((i) => i.instanceId === instanceId);
        if (!item) return;
        const current = item.manualOffset ?? { x: 0, y: 0 };
        item.manualOffset = { x: current.x + delta.x, y: current.y + delta.y };
      }),

    resetOffset: (instanceId) =>
      get().update((d) => {
        const item = d.line.find((i) => i.instanceId === instanceId);
        if (item) delete item.manualOffset;
      }),

    /* ── Flödesskelettet ────────────────────────────────────────────── */

    drawFlowArrow: (from, to) => {
      const before = get().config;
      let graph: FlowGraph = before.flowGraph
        ? clone(before.flowGraph)
        : { nodes: [], edges: [] };
      let line = clone(before.line);

      /*
       * Första pilen är linjen.
       *
       * Förr la den här koden till en osynlig sträcka från flödets startpunkt
       * tvärs hallen, så att maskinerna hade någonstans att bo. Resultatet var
       * att den som ritade sitt flöde fick en gren till som hen aldrig ritat —
       * och maskinerna stod kvar på den, långt från pilarna. Nu blir pilen
       * linjen, och maskinerna följer med dit.
       *
       * Undantaget är när pilen fäster i en maskin. Då finns linjen redan och
       * ska klippas, så den behöver en sträcka att klippas ur.
       */
      const startingFresh = graph.edges.length === 0;
      const touchesMachine = from.kind === "machine" || to.kind === "machine";

      if (startingFresh && touchesMachine && line.length > 0) {
        const bounds = get().layout.bounds;
        const start = makeNode(graph, "infeed", before.flow.startPoint, "x+");
        const end = makeNode(graph, "outfeed", {
          // Där linjen faktiskt slutar idag, så att skelettet ligger på den.
          x: Math.round(bounds.x + bounds.l),
          y: before.flow.startPoint.y,
        });
        graph.nodes.push(start, end);
        const spine = makeEdge(graph, start.id, end.id);
        graph.edges.push(spine);
        line = line.map((i) => (i.edgeId ? i : { ...i, edgeId: spine.id }));
      }

      /** Punkten en ände fäster i: en befintlig nod, en ny på golvet, eller en maskin. */
      const anchor = (side: FlowAnchor, where: "before" | "after"): string | null => {
        if (side.kind === "point") {
          // Släpps pilen på en punkt som redan finns är det den som menas.
          const near = nodeNear(graph, side.at);
          if (near) return near.id;
          const node = makeNode(graph, "junction", side.at, "x+");
          graph.nodes.push(node);
          return node.id;
        }
        /*
         * Mötet läggs på maskinens port, inte där pekaren råkade släppas.
         * Det är porten paketen faktiskt kommer in i eller lämnar ur, och en
         * gren som slutar en meter bredvid den ser fel ut i ritningen.
         */
        const placement = get().layout.placements.find((p) => p.instanceId === side.instanceId);
        const port = placement?.ports.find((p) => p.role === (where === "before" ? "in" : "out"));
        const split = splitEdge(graph, line, side.instanceId, port?.pos ?? side.at, where);
        if (!split) return null;
        graph = split.graph;
        line = split.line;
        return split.nodeId;
      };

      // Källan först: en delning sker efter maskinen man drar ifrån.
      const fromId = anchor(from, "after");
      const toId = anchor(to, "before");
      if (!fromId || !toId || fromId === toId) return null;

      const edge = makeEdge(graph, fromId, toId);
      graph.edges.push(edge);

      // Den allra första pilen tar med sig linjen som redan står i hallen.
      if (startingFresh && !touchesMachine) {
        line = line.map((i) => (i.edgeId ? i : { ...i, edgeId: edge.id }));
      }

      get().update((d) => {
        d.flowGraph = graph;
        d.line = line;
      });
      set({ selectedEdgeId: edge.id, selectedId: null });
      return edge.id;
    },

    addFlowNode: (kind, at, dir = "x+") => {
      const graph = get().config.flowGraph ?? EMPTY_GRAPH;
      const node = makeNode(graph, kind, at, dir);
      get().update((d) => {
        d.flowGraph = d.flowGraph ?? { nodes: [], edges: [] };
        d.flowGraph.nodes.push(node);
      });
      return node.id;
    },

    connectFlow: (fromNodeId, toNodeId) => {
      const graph = get().config.flowGraph ?? EMPTY_GRAPH;
      if (fromNodeId === toNodeId) return null;
      // Samma sträcka två gånger är ingen ny väg, bara en dubbelritad.
      if (graph.edges.some((e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId)) {
        return null;
      }
      const edge = makeEdge(graph, fromNodeId, toNodeId);
      const first = graph.edges.length === 0;
      get().update((d) => {
        d.flowGraph = d.flowGraph ?? { nodes: [], edges: [] };
        d.flowGraph.edges.push(edge);
        /*
         * Första sträckan ärver linjen som redan står i hallen. Maskinerna
         * byggdes innan flödet ritades och hör till den vägen — att låta dem
         * hänga utan gren vore att göra dem osynliga i remsan medan de står
         * kvar i ritningen.
         */
        if (first) for (const item of d.line) if (!item.edgeId) item.edgeId = edge.id;
      });
      set({ selectedEdgeId: edge.id });
      return edge.id;
    },

    moveFlowNode: (id, at) =>
      get().update((d) => {
        const node = d.flowGraph?.nodes.find((n) => n.id === id);
        if (node) node.at = at;
      }),

    updateFlowNode: (id, patch) =>
      get().update((d) => {
        const node = d.flowGraph?.nodes.find((n) => n.id === id);
        if (node) Object.assign(node, patch);
      }),

    updateFlowEdge: (id, patch) =>
      get().update((d) => {
        const edge = d.flowGraph?.edges.find((e) => e.id === id);
        if (edge) Object.assign(edge, patch);
      }),

    removeFlowNode: (id) => {
      const doomed = (get().config.flowGraph?.edges ?? [])
        .filter((e) => e.fromNodeId === id || e.toNodeId === id)
        .map((e) => e.id);
      get().update((d) => {
        if (!d.flowGraph) return;
        d.flowGraph = removeNode(d.flowGraph, id);
        // Maskinerna på en borttagen sträcka blir kvar i listan, utan gren.
        // De syns i linjeremsan och kan flyttas till en annan — att kasta
        // dem vore att kasta någons arbete för att en punkt togs bort.
        for (const item of d.line) if (item.edgeId && doomed.includes(item.edgeId)) delete item.edgeId;
      });
      if (doomed.includes(get().selectedEdgeId ?? "")) set({ selectedEdgeId: null });
    },

    removeFlowEdge: (id) => {
      get().update((d) => {
        if (!d.flowGraph) return;
        d.flowGraph.edges = d.flowGraph.edges.filter((e) => e.id !== id);
        for (const item of d.line) if (item.edgeId === id) delete item.edgeId;
      });
      if (get().selectedEdgeId === id) set({ selectedEdgeId: null });
    },

    selectEdge: (id) => set({ selectedEdgeId: id, selectedId: null }),

    clearFlowGraph: () => {
      get().update((d) => {
        delete d.flowGraph;
        for (const item of d.line) delete item.edgeId;
      });
      set({ selectedEdgeId: null });
    },

    addDrawn: (obj) => {
      get().update((d) => {
        d.drawn.push(obj);
      });
      get().select(obj.id);
    },

    updateDrawn: (id, patch) =>
      get().update((d) => {
        const object = d.drawn.find((o) => o.id === id);
        if (object) Object.assign(object, patch);
      }),

    removeDrawn: (id) => {
      get().update((d) => {
        d.drawn = d.drawn.filter((o) => o.id !== id);
      });
      if (get().selectedId === id) set({ selectedId: null });
    },

    clearDrawn: () =>
      get().update((d) => {
        d.drawn = [];
      }),

    applyPatch: (patch) => {
      switch (patch.kind) {
        case "flow":
          get().setFlow(patch.patch);
          break;
        case "addMachine":
          get().addMachine(patch.machineId);
          break;
        case "fitEdge":
          get().updateFlowEdge(patch.edgeId, { fit: true });
          break;
        case "removeMachine":
          get().removeItem(patch.instanceId);
          break;
      }
    },

    undo: () => {
      const { past, config, future } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        config: previous,
        layout: computeLayout(previous, get().library),
        past: past.slice(0, -1),
        future: [config, ...future].slice(0, HISTORY_LIMIT),
      });
      persist(previous);
    },

    redo: () => {
      const { future, config, past } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        config: next,
        layout: computeLayout(next, get().library),
        past: [...past, config].slice(-HISTORY_LIMIT),
        future: future.slice(1),
      });
      persist(next);
    },

    hydrate: () => {
      if (get().hydrated) return;
      set({ hydrated: true });
      if (typeof window === "undefined") return;

      // Loggen läses först: det som hände före omladdningen hände ändå.
      set({ log: readLog() });

      const params = new URLSearchParams(window.location.search);

      /*
       * En offert öppnad från adminvyn. Den läses från servern med sitt id, så
       * att rabatt och historik följer med — och så att den som sparar skriver
       * tillbaka till samma rad i stället för att lägga en kopia bredvid.
       */
      const quoteId = params.get("offert");
      if (quoteId) {
        fetch(`/api/admin/proposals?id=${encodeURIComponent(quoteId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            const proposal = data?.proposal;
            if (!proposal) return;
            get().load(proposal.config as Configuration, {
              resetHistory: true,
              note: `Öppnade offerten "${proposal.name}" från adminvyn`,
            });
            if (Array.isArray(proposal.log)) get().setLog(proposal.log);
            set({ proposalId: proposal.id, screen: "configurator" });
          })
          .catch(() => {
            // Utan svar står utkastet kvar; ingen tyst standardkonfiguration.
          });
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }

      const shared = params.get("c");
      if (shared) {
        // Delningslänken importeras lazy för att hålla första bundlen liten.
        Promise.all([import("@/lib/share"), import("@/lib/quote")]).then(
          ([{ decodeConfig }, { quoteReference }]) =>
            decodeConfig(shared).then((result) => {
              if (!result.ok) {
                // Tyst standardkonfiguration vore det värsta svaret: den som
                // klickade skulle tro att hen ser avsändarens anläggning.
                set({ shareNotice: { kind: result.reason }, screen: "configurator" });
                return;
              }

              const previous = readLocalDraft();
              if (previous) {
                try {
                  window.localStorage.setItem(RESCUE_KEY, JSON.stringify(previous));
                } catch {
                  // Utan plats för räddningskopian erbjuds den inte heller.
                }
              }

              get().load(result.config, {
                resetHistory: true,
                note: `Öppnade en delad konfiguration (${quoteReference(result.config)})`,
              });
              set({
                screen: "configurator",
                shareNotice: {
                  kind: "loaded",
                  reference: quoteReference(result.config),
                  hadLocalDraft: !!previous,
                },
              });
            }),
        );
        // Adressraden städas direkt: en reload ska visa det man håller på med
        // nu, inte importera den delade konfigurationen en gång till över det.
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState(null, "", clean);
        return;
      }

      const saved = readLocalDraft();
      if (saved) get().load(saved, { resetHistory: true });
    },

    dismissShareNotice: () => set({ shareNotice: null }),

    restorePreviousDraft: () => {
      if (typeof window === "undefined") return false;
      let previous: Configuration | null = null;
      try {
        const raw = window.localStorage.getItem(RESCUE_KEY);
        previous = raw ? (JSON.parse(raw) as Configuration) : null;
      } catch {
        previous = null;
      }
      if (previous?.version !== 1) return false;
      get().load(previous, { resetHistory: true });
      set({ shareNotice: null });
      return true;
    },
  };
});
