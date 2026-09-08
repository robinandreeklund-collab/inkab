"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { AiPanel } from "./AiPanel";
import { CadView } from "./CadView";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { Inspector } from "./Inspector";
import { LineStrip } from "./LineStrip";
import { Onboarding } from "./Onboarding";
import { QuoteView } from "./QuoteView";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { Topbar } from "./Topbar";
import { Button } from "./ui";
import type { PriceResult } from "@/lib/server/pricing";

export function AppShell() {
  const {
    config,
    screen,
    inspectorOpen,
    tool,
    hydrate,
    hydrated,
    setTool,
    setView,
    undo,
    redo,
    toggleInspector,
    toggleZones,
    togglePorts,
    selectedId,
    removeItem,
    removeDrawn,
  } = useConfigStore();

  const [role, setRole] = useState<"guest" | "sales">("guest");
  const [price, setPrice] = useState<PriceResult | null>(null);
  const priceRequest = useRef(0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((data) => setRole(data.role === "sales" ? "sales" : "guest"))
      .catch(() => setRole("guest"));
  }, []);

  /* Priset räknas alltid på servern. Debounce så att varje knapptryck inte
     genererar ett anrop, och ignorera svar som hunnit bli inaktuella. */
  useEffect(() => {
    const id = ++priceRequest.current;
    const timer = setTimeout(() => {
      fetch("/api/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (id === priceRequest.current) setPrice(data);
        })
        .catch(() => {
          if (id === priceRequest.current) setPrice(null);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [config, role]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }

      switch (event.key.toLowerCase()) {
        case "1":
          setView("2d");
          break;
        case "2":
          setView("3d");
          break;
        case "v":
          setTool("select");
          break;
        case "w":
          setTool("wall");
          break;
        case "n":
          setTool("nogo");
          break;
        case "m":
          setTool("measure");
          break;
        case "z":
          toggleZones();
          break;
        case "p":
          togglePorts();
          break;
        case "f":
          toggleInspector();
          break;
        case "delete":
        case "backspace":
          if (!selectedId) break;
          if (config.drawn.some((d) => d.id === selectedId)) removeDrawn(selectedId);
          else removeItem(selectedId);
          break;
      }
    },
    [
      config.drawn,
      redo,
      removeDrawn,
      removeItem,
      selectedId,
      setTool,
      setView,
      toggleInspector,
      togglePorts,
      toggleZones,
      undo,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  if (!hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted">Laddar…</div>
    );
  }

  if (screen === "onboarding") {
    return (
      <div className="flex h-dvh flex-col">
        <Topbar role={role} onRoleChange={setRole} />
        <div className="min-h-0 flex-1">
          <Onboarding />
        </div>
      </div>
    );
  }

  if (screen === "quote") {
    return (
      <div className="flex h-dvh flex-col">
        <Topbar role={role} onRoleChange={setRole} />
        <div className="min-h-0 flex-1">
          <QuoteView price={price} role={role} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <Topbar role={role} onRoleChange={setRole} />

      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <CadView />
            <DiagnosticsPanel />
            <AiPanel />
            <ToolRail />
          </div>
          <LineStrip />
        </main>

        {inspectorOpen ? (
          <Inspector price={price} role={role} />
        ) : (
          <button
            onClick={toggleInspector}
            className="kicker w-8 flex-none border-l border-divider bg-white hover:bg-paper"
            style={{ writingMode: "vertical-rl" }}
          >
            Inspektor
          </button>
        )}
      </div>

      <StatusBar price={price} />
    </div>
  );
}

function ToolRail() {
  const { tool, setTool, showZones, showPorts, toggleZones, togglePorts } = useConfigStore();

  return (
    <div className="absolute right-3 top-3 flex flex-col gap-1">
      {(
        [
          ["select", "Markera och flytta (V)", "m4 3 7 17 2.5-6.5L20 11z"],
          ["wall", "Rita vägg (W)", "M3 6h18M3 12h18M3 18h18M8 6v6M16 12v6"],
          ["nogo", "Rita no-go-zon (N)", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m-6 15 12-12"],
          ["measure", "Mät avstånd (M)", "M3 9h18v6H3zM7 9v3M11 9v3M15 9v3M19 9v3"],
        ] as const
      ).map(([value, title, path]) => (
        <Button
          key={value}
          size="sm"
          title={title}
          active={tool === value}
          onClick={() => setTool(value)}
          className="h-8 w-8 p-0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d={path} />
          </svg>
        </Button>
      ))}
      <Button size="sm" title="Visa zoner (Z)" active={showZones} onClick={toggleZones} className="h-8 w-8 p-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3h18v18H3z" strokeDasharray="3 2" />
        </svg>
      </Button>
      <Button size="sm" title="Visa portar (P)" active={showPorts} onClick={togglePorts} className="h-8 w-8 p-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="12" r="2.5" />
          <circle cx="17" cy="12" r="2.5" />
          <path d="M9.5 12h5" />
        </svg>
      </Button>
    </div>
  );
}
