"use client";

import { create } from "zustand";
import { computeLayout } from "@/lib/layout";
import { BUILTIN_LIBRARY, getMachine, makeLibrary, type MachineLibrary } from "@/lib/library";
import { defaultConfig, lineItem } from "@/lib/templates";
import type {
  ConfigPatch,
  Configuration,
  DrawnObject,
  Flow,
  LayoutResult,
  Machine,
  ParameterValue,
  Vec2,
} from "@/lib/types";

const HISTORY_LIMIT = 60;
const STORAGE_KEY = "inkab.config.v1";

export type Tool = "select" | "wall" | "door" | "truck" | "nogo" | "measure";
export type ViewMode = "2d" | "3d";
export type Unit = "m" | "mm";

type Screen = "onboarding" | "configurator" | "quote";

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
  load: (config: Configuration, options?: { resetHistory?: boolean }) => void;
  update: (recipe: (draft: Configuration) => void) => void;
  setFlow: (patch: Partial<Flow>) => void;
  setFlowPoint: (which: "startPoint" | "endPoint", point: Vec2 | null) => void;
  addMachine: (machineId: string, atIndex?: number) => void;
  removeItem: (instanceId: string) => void;
  moveItem: (instanceId: string, toIndex: number) => void;
  toggleOption: (instanceId: string, optionId: string) => void;
  setParameter: (instanceId: string, parameterId: string, value: ParameterValue) => void;
  nudge: (instanceId: string, delta: Vec2) => void;
  resetOffset: (instanceId: string) => void;
  addDrawn: (obj: DrawnObject) => void;
  updateDrawn: (id: string, patch: Partial<DrawnObject>) => void;
  removeDrawn: (id: string) => void;
  clearDrawn: () => void;
  applyPatch: (patch: ConfigPatch) => void;

  undo: () => void;
  redo: () => void;
  hydrate: () => void;
};

/** Djupkopia utan beroenden; konfigurationen är ren JSON. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function persist(config: Configuration) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Privat läge eller full kvot — autospar är en bekvämlighet, inte ett krav.
  }
}

export const useConfigStore = create<State & Actions>((set, get) => {
  const initial = defaultConfig();

  const commit = (next: Configuration) => {
    const { config, past, library } = get();
    set({
      config: next,
      layout: computeLayout(next, library),
      past: [...past, config].slice(-HISTORY_LIMIT),
      future: [],
    });
    persist(next);
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
    inspectorOpen: true,
    aiOpen: false,
    diagnosticsOpen: false,
    showZones: true,
    showPorts: false,
    hydrated: false,

    setScreen: (screen) => set({ screen }),
    setView: (view) => set({ view }),
    setUnit: (unit) => set({ unit }),
    setTool: (tool) => set({ tool }),
    select: (selectedId) => set({ selectedId }),
    toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
    toggleAi: (open) => set((s) => ({ aiOpen: open ?? !s.aiOpen })),
    toggleDiagnostics: (open) => set((s) => ({ diagnosticsOpen: open ?? !s.diagnosticsOpen })),
    toggleZones: () => set((s) => ({ showZones: !s.showZones })),
    togglePorts: () => set((s) => ({ showPorts: !s.showPorts })),

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
      } else {
        commit(next);
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
        set({ selectedId: existing.instanceId });
        return;
      }
      const item = lineItem(machineId);
      get().update((d) => {
        const index = atIndex ?? d.line.length;
        d.line.splice(Math.max(0, Math.min(d.line.length, index)), 0, item);
      });
      set({ selectedId: item.instanceId });
    },

    removeItem: (instanceId) => {
      get().update((d) => {
        d.line = d.line.filter((i) => i.instanceId !== instanceId);
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

    addDrawn: (obj) => {
      get().update((d) => {
        d.drawn.push(obj);
      });
      set({ selectedId: obj.id });
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

      const params = new URLSearchParams(window.location.search);
      const shared = params.get("c");
      if (shared) {
        // Delningslänken importeras lazy för att hålla första bundlen liten.
        import("@/lib/share").then(({ decodeConfig }) => {
          const config = decodeConfig(shared);
          if (config) get().load(config, { resetHistory: true });
          set({ screen: "configurator" });
        });
        return;
      }

      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Configuration;
        if (parsed?.version === 1) get().load(parsed, { resetHistory: true });
      } catch {
        // Ogiltigt autospar ignoreras; standardkonfigurationen gäller.
      }
    },
  };
});
