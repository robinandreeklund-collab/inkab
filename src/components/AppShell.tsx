"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { AiPanel } from "./AiPanel";
import { CadView } from "./CadView";
import { ShareNotice } from "./ShareNotice";
import { ModelView } from "./ModelView";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { DraftJobWatcher } from "./DraftJobWatcher";
import { Inspector } from "./Inspector";
import { LineStrip } from "./LineStrip";
import { Onboarding } from "./Onboarding";
import { QuoteView } from "./QuoteView";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { Topbar } from "./Topbar";
import { Button } from "./ui";
import type { PriceResult, Role } from "@/lib/server/pricing";
import type { SessionUser } from "./AuthDialog";

export function AppShell() {
  const {
    config,
    screen,
    inspectorOpen,
    view,
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
    proposalId,
  } = useConfigStore();

  const [user, setUser] = useState<SessionUser | null>(null);
  const role: Role = user?.role ?? "guest";
  // /admin skickar hit besökare som saknar behörighet; öppna inloggningen direkt.
  const [askLogin, setAskLogin] = useState(false);
  const [price, setPrice] = useState<PriceResult | null>(null);
  const priceRequest = useRef(0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("admin")) setAskLogin(true);
  }, []);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.machines?.length) useConfigStore.getState().setLibrary(data.machines);
      })
      .catch(() => {
        // Servern är inte nåbar — det inbyggda biblioteket duger.
      });
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data?.user ?? null))
      .catch(() => setUser(null));
  }, []);

  /* Priset räknas alltid på servern. Debounce så att varje knapptryck inte
     genererar ett anrop, och ignorera svar som hunnit bli inaktuella. */
  useEffect(() => {
    const id = ++priceRequest.current;
    const timer = setTimeout(() => {
      fetch("/api/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Offertens id följer med så att serverns pris blir offertens pris,
        // rabatten inräknad. Konfigurationen ensam vet inget om affären.
        body: JSON.stringify({ config, proposalId }),
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
  }, [config, user, proposalId]);

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
        case "3":
          setView("model");
          break;
        case "v":
          setTool("select");
          break;
        case "w":
          setTool("wall");
          break;
        case "d":
          setTool("door");
          break;
        case "t":
          setTool("truck");
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
        <Topbar
          user={user}
          onUserChange={setUser}
          autoOpenLogin={askLogin}
          onLoginHandled={() => setAskLogin(false)}
        />
        <div className="min-h-0 flex-1">
          <Onboarding />
        </div>
      </div>
    );
  }

  if (screen === "quote") {
    return (
      <div className="flex h-dvh flex-col">
        <Topbar
          user={user}
          onUserChange={setUser}
          autoOpenLogin={askLogin}
          onLoginHandled={() => setAskLogin(false)}
        />
        <div className="min-h-0 flex-1">
          <QuoteView price={price} role={role} user={user} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <Topbar
          user={user}
          onUserChange={setUser}
          autoOpenLogin={askLogin}
          onLoginHandled={() => setAskLogin(false)}
        />

      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <ShareNotice />
            {view === "model" ? <ModelView /> : <CadView />}
            <DraftJobWatcher />
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
          ["door", "Rita port (D)", "M4 21V4h10v17M14 12h1M4 21h16"],
          ["truck", "Rita truckgata (T)", "M2 16h13V8H2zM15 11h4l3 3v2h-7zM6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M18 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"],
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
