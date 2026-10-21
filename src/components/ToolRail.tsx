"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { useT } from "@/lib/i18n";
import { Button, cx, Tip } from "./ui";
import { ZONES } from "@/lib/zones";
import { toolHelp } from "./toolHelp";
import type { Tool } from "@/store/useConfigStore";

/**
 * Ritverktygen.
 *
 * Raden låg förut inbakad i skalet och bara i planvyn. Den flyttade hit när
 * modellvyn också fick rita: samma knappar, samma ordning och samma
 * förklaringar på båda ställena, så att man inte behöver lära sig verktyget
 * två gånger. Vyn säger var raden står och vilka verktyg den visar — allt
 * annat är lika.
 */

const ICON: Record<Tool, string> = {
  select: "m4 3 7 17 2.5-6.5L20 11z",
  wall: "M3 6h18M3 12h18M3 18h18M8 6v6M16 12v6",
  door: "M4 21V4h10v17M14 12h1M4 21h16",
  zone: "M3 4h18v16H3zM3 9h18M9 4v16",
  measure: "M3 9h18v6H3zM7 9v3M11 9v3M15 9v3M19 9v3",
};

export const PLAN_TOOLS: Tool[] = ["select", "wall", "door", "zone", "measure"];

/**
 * Modellvyn mäter inte. Ett sparat mått ritas bara i planen, så en
 * mätknapp här skulle lämna kunden med ett mått som inte syns där det
 * togs — hellre inget verktyg än ett som inte håller vad det lovar.
 */
export const MODEL_TOOLS: Tool[] = ["select", "wall", "door", "zone"];

export function ToolRail({
  side = "right",
  tools = PLAN_TOOLS,
  /** Lagerknapparna gäller planvyns ritning och hör bara dit. */
  layers = true,
}: {
  side?: "left" | "right";
  tools?: Tool[];
  layers?: boolean;
}) {
  const {
    tool,
    setTool,
    zoneKind,
    setZoneKind,
    showZones,
    showPorts,
    toggleZones,
    togglePorts,
  } = useConfigStore();
  const t = useT();
  const tipSide = side === "left" ? "right" : "left";

  return (
    <div
      className={cx(
        "absolute top-3 z-10 flex flex-col gap-1",
        side === "left" ? "left-3 items-start" : "right-3 items-end",
      )}
    >
      {tools.map((value) => {
        const help = toolHelp(t, value);
        return (
          <Tip
            key={value}
            side={tipSide}
            title={help.title}
            body={help.body}
            shortcut={help.shortcut}
          >
            <Button
              size="sm"
              active={tool === value}
              onClick={() => setTool(value)}
              className="h-8 w-8 p-0"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d={ICON[value]} />
              </svg>
              <span className="sr-only">{help.title}</span>
            </Button>
          </Tip>
        );
      })}
      {/*
        Vilken sorts zon verktyget ritar, framme så länge zonverktyget är
        valt. Att gå tillbaka till ytan för att byta från truckzon till
        lageryta mitt i ritandet är ett avbrott i precis det man håller på
        med — och man ritar zoner just när man tittar på ritningen.
      */}
      {tool === "zone" ? (
        <div className="flex w-[150px] flex-col gap-0.5 border border-divider bg-white/95 p-1 backdrop-blur">
          {ZONES.map((zone) => (
            <button
              key={zone.id}
              onClick={() => setZoneKind(zone.id)}
              title={t(zone.hintKey)}
              className={cx(
                "flex items-center gap-1.5 px-1.5 py-1 text-left text-[11px] transition-colors",
                zoneKind === zone.id
                  ? "bg-accent text-white"
                  : "hover:bg-paper",
              )}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 flex-none border"
                style={{
                  borderColor: zoneKind === zone.id ? "#ffffff" : zone.stroke,
                  background:
                    zoneKind === zone.id ? "#ffffff" : `${zone.tint}26`,
                }}
              />
              <span className="min-w-0 truncate">{t(zone.labelKey)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {layers ? (
        <>
          <Tip
            side={tipSide}
            title={t("cad.zones")}
            body={t("tip.zones.body")}
            shortcut="G"
          >
            <Button
              size="sm"
              active={showZones}
              onClick={toggleZones}
              className="h-8 w-8 p-0"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M3 3h18v18H3z" strokeDasharray="3 2" />
              </svg>
            </Button>
          </Tip>
          <Tip
            side={tipSide}
            title={t("cad.arrows")}
            body={t("tip.arrows.body")}
            shortcut="P"
          >
            <Button
              size="sm"
              active={showPorts}
              onClick={togglePorts}
              className="h-8 w-8 p-0"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="7" cy="12" r="2.5" />
                <circle cx="17" cy="12" r="2.5" />
                <path d="M9.5 12h5" />
              </svg>
            </Button>
          </Tip>
        </>
      ) : null}
    </div>
  );
}
