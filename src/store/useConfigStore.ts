"use client";

import { create } from "zustand";
import { computeLayout } from "@/lib/layout";
import { BUILTIN_LIBRARY, getMachine, makeLibrary, type MachineLibrary } from "@/lib/library";
import { defaultConfig, lineItem } from "@/lib/templates";
import { removeWithBranches, segmentEndIndex } from "@/lib/branches";
import { describeChange, logEntry, LOG_LIMIT, type LogEntry, type LogKind } from "@/lib/projectLog";
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
/**
 * Utkastet som låg här när en delningslänk öppnades. En länk skriver över
 * det som fanns, och utan den här nyckeln vore det arbetet borta utan att
 * någon frågat. Bannern erbjuder att gå tillbaka.
 */
const RESCUE_KEY = "inkab.config.before-share";
/** Projektets logg. Ligger vid sidan av konfigurationen, se lib/projectLog.ts. */
const LOG_KEY = "inkab.log.v1";

export type Tool = "select" | "wall" | "door" | "truck" | "nogo" | "measure";
export type ViewMode = "2d" | "3d" | "model";
export type Unit = "m" | "mm";

type Screen = "onboarding" | "configurator" | "quote";

/**
 * Vad som hände när sidan öppnades med en delningslänk. Null betyder att
 * ingen länk var med — inte att allt gick bra.
 */
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
   * Utgången nästa maskin ska hängas på. Satt när någon tryckt "bygg vidare
   * härifrån" på en ledig utgång; nästa maskin ur katalogen startar då en
   * gren i stället för att läggas sist.
   */
  branchTarget: { instanceId: string; outPortId: string } | null;
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
    branchTarget: null,

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
