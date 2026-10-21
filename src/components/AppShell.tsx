"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { useLocale, useT } from "@/lib/i18n";
import { AiPanel } from "./AiPanel";
import { CadView } from "./CadView";
import { ShareNotice } from "./ShareNotice";
import { ModelView } from "./ModelView";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { DraftJobWatcher } from "./DraftJobWatcher";
import { Onboarding } from "./Onboarding";
import { QuoteView } from "./QuoteView";
import { NavMenu } from "./NavMenu";
import { AreaPanel } from "./AreaPanel";
import { StatusBar } from "./StatusBar";
import { Topbar } from "./Topbar";
import { MODEL_TOOLS, ToolRail } from "./ToolRail";
import type { PriceResult, Role } from "@/lib/server/pricing";
import type { SessionUser } from "./AuthDialog";

export function AppShell() {
  const {
    config,
    screen,
    inspectorOpen,
    view,
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
    turnDrawn,
    turnMachine,
    mirrorMachine,
    proposalId,
  } = useConfigStore();

  const t = useT();
  const locale = useLocale();
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
    if (new URLSearchParams(window.location.search).has("admin"))
      setAskLogin(true);
  }, []);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.machines?.length)
          useConfigStore.getState().setLibrary(data.machines);
        else useConfigStore.setState({ libraryLoaded: true });
      })
      .catch(() => {
        // Servern är inte nåbar — det inbyggda biblioteket duger. Säg ändå
        // att biblioteket är klart, annars väntar startsidans mallar för evigt.
        useConfigStore.setState({ libraryLoaded: true });
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
        body: JSON.stringify({ config, proposalId, locale }),
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
  }, [config, user, proposalId, locale]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;

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
        case "escape":
          setTool("select");
          break;
        case "1":
          setView("2d");
          break;
        case "2":
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
        case "z":
          setTool("zone");
          break;
        case "m":
          /*
           * Mätverktyget finns bara i planen: ett sparat mått ritas där och
           * inte i modellen. Står man i 3D byter tangenten därför vy i
           * stället för att välja ett verktyg som inte gör något.
           */
          if (view === "model") setView("2d");
          setTool("measure");
          break;
        case "g":
          // Maskinernas egna zoner — service, skydd, fri yta.
          toggleZones();
          break;
        case "p":
          togglePorts();
          break;
        case "f":
          toggleInspector();
          break;
        case "r":
          /*
           * Vrida ska gå där man står. Att behöva sikta på en liten knapp i
           * inspektorn för varje kvarts varv är ett avbrott mitt i arbetet —
           * man tittar bort från ritningen för att ändra något man ser i den.
           * Skift vrider åt andra hållet.
           */
          if (!selectedId) break;
          event.preventDefault();
          if (config.drawn.some((d) => d.id === selectedId))
            turnDrawn(selectedId);
          else if (config.line.some((i) => i.instanceId === selectedId)) {
            turnMachine(selectedId, event.shiftKey ? -1 : 1);
          }
          break;
        case "s":
          /*
           * Spegla där man står, precis som R vrider där man står.
           *
           * Spegelknappen satt som en ikon utan text inne i inspektorns
           * rotationsrad, och bara för maskiner som går att spegla. Den var
           * inte att hitta, och den är den enda åtgärden som avgör vilken
           * sida pulpeten hamnar på. Nu finns den på tre ställen: tangenten,
           * handtaget vid den markerade maskinen, och en egen rad i
           * inspektorn med utskrivet namn och läge.
           */
          if (!selectedId) break;
          event.preventDefault();
          if (config.line.some((i) => i.instanceId === selectedId))
            mirrorMachine(selectedId);
          break;
        case "delete":
        case "backspace":
          if (!selectedId) break;
          if (config.drawn.some((d) => d.id === selectedId))
            removeDrawn(selectedId);
          else if (config.dimensions?.some((d) => d.id === selectedId)) {
            useConfigStore.getState().removeDimension(selectedId);
          } else removeItem(selectedId);
          break;
      }
    },
    [
      config.drawn,
      config.dimensions,
      config.line,
      mirrorMachine,
      redo,
      removeDrawn,
      removeItem,
      selectedId,
      setTool,
      setView,
      toggleInspector,
      turnDrawn,
      turnMachine,
      togglePorts,
      toggleZones,
      undo,
      view,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  if (!hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted">
        Laddar…
      </div>
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
        <NavMenu />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <ShareNotice />
            {view === "model" ? <ModelView /> : <CadView />}
            <DraftJobWatcher />
            <DiagnosticsPanel />
            {/* Assistenten kostar per fråga och är till för kunder med konto. */}
            {user ? <AiPanel /> : null}
            {/*
              Ritverktygen finns i båda vyerna. I modellen står raden till
              vänster, så att den inte lägger sig över kamerakontrollen, och
              utan mätverktyg och lagerknappar — de hör till planens ritning.
            */}
            {view === "model" ? (
              <ToolRail side="left" tools={MODEL_TOOLS} layers={false} />
            ) : (
              <ToolRail />
            )}
          </div>
        </main>

        {inspectorOpen ? (
          <AreaPanel price={price} role={role} />
        ) : (
          <button
            onClick={toggleInspector}
            className="kicker w-8 flex-none border-l border-divider bg-white hover:bg-paper"
            style={{ writingMode: "vertical-rl" }}
          >
            {t("area.panel")}
          </button>
        )}
      </div>

      <StatusBar price={price} />
    </div>
  );
}
