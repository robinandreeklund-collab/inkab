"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { groupOf, isAreaDone, nextArea, previousArea } from "@/lib/areas";
import { useT } from "@/lib/i18n";
import { AreaBody } from "./AreaPanels";
import { Inspector } from "./Inspector";
import { Button } from "./ui";
import type { PriceResult, Role } from "@/lib/server/pricing";

/**
 * Panelen till höger: den yta man arbetar med, eller det man har markerat.
 *
 * Överst står var man är och vad som ska anges här — och varför det spelar
 * roll för offerten. Längst ner leder en knapp vidare till nästa yta, så att
 * ingen behöver fundera över vad som kommer sedan.
 */
export function AreaPanel({ price, role }: { price: PriceResult | null; role: Role }) {
  const t = useT();
  const { config, layout, area, setArea, selectedId, confirmedAreas, confirmArea, toggleInspector } =
    useConfigStore();
  const selected =
    !!selectedId &&
    (config.line.some((i) => i.instanceId === selectedId) || config.drawn.some((d) => d.id === selectedId));
  const next = nextArea(area);
  const previous = previousArea(area);
  const done = isAreaDone(area, config, layout, new Set(confirmedAreas));

  return (
    <aside className="flex h-full w-[320px] flex-none flex-col border-l border-divider bg-white">
      {selected ? (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <Inspector price={price} role={role} backLabel={t(`area.${area}.title`)} />
        </div>
      ) : (
        <>
          <header className="border-b border-divider px-3 py-3">
            <div className="flex items-center justify-between">
              <span className="kicker">{t(`group.${groupOf(area).id}`)}</span>
              <button onClick={toggleInspector} className="kicker hover:text-ink" title={t("area.collapse")}>
                {t("inspector.collapse")}
              </button>
            </div>
            <h2 className="mt-0.5 text-lg leading-tight">{t(`area.${area}.title`)}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">{t(`area.${area}.why`)}</p>
          </header>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
            <AreaBody area={area} />
          </div>

          <footer className="flex items-center gap-2 border-t border-divider p-3">
            {previous ? (
              <Button size="sm" variant="ghost" onClick={() => setArea(previous)}>
                ‹ {t("area.previous")}
              </Button>
            ) : null}
            {next ? (
              <Button
                variant="primary"
                className="ml-auto"
                onClick={() => {
                  // Att gå vidare är att säga att ytan är klar, också när den
                  // inte går att bocka av på egen hand.
                  if (!done) confirmArea(area);
                  setArea(next);
                }}
              >
                {t("area.next", { title: t(`area.${next}.title`) })} ›
              </Button>
            ) : null}
          </footer>
        </>
      )}
    </aside>
  );
}
