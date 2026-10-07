"use client";

import { useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { AREA_GROUPS, AREA_ORDER, firstOpenArea, isAreaDone, type Area } from "@/lib/areas";
import { meters } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cx, Tip } from "./ui";

/**
 * Menyn till vänster: var man är, vad som är klart och vad som är nästa steg.
 *
 * Ytorna är grupperade och grupperna fälls upp och ner. Varje yta har ett
 * nummer som blir en bock när den är klar, och en kort rad om vad som står i
 * den just nu — "46 × 22,5 m", "2 portar" — så att man ser läget utan att
 * öppna något. Ytan som är nästa steg är märkt.
 */
export function NavMenu() {
  const t = useT();
  const { config, layout, area, setArea, confirmedAreas, selectedId } = useConfigStore();
  const confirmed = new Set(confirmedAreas);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const next = firstOpenArea(config, layout, confirmed);
  const doneCount = AREA_ORDER.filter((a) => isAreaDone(a, config, layout, confirmed)).length;
  const count = (kind: string) => config.drawn.filter((d) => d.kind === kind).length;
  const errors = layout.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = layout.diagnostics.filter((d) => d.severity === "warning").length;

  const status: Record<Area, string> = {
    hall: `${meters(config.hall.lengthMm)} × ${meters(config.hall.widthMm)} m`,
    walls: t("nav.status.walls", { doors: count("door"), walls: count("wall") }),
    zones: t("nav.status.zones", { count: count("nogo") }),
    machines: t("nav.status.machines", { count: config.line.length }),
    line:
      errors + warnings === 0
        ? t("nav.status.lineOk")
        : t("nav.status.lineIssues", { errors, warnings }),
    points: t("nav.status.points", { count: 1 + (config.flow.markers?.length ?? 0) }),
    truck: t("nav.status.truck", { count: count("truck") }),
    product: `${meters(config.product.packageWidthMinMm)}–${meters(config.product.packageWidthMaxMm)} m · ${config.product.targetPackagesPerHour} pkt/h`,
    quote: t("nav.status.quote"),
  };

  return (
    <nav className="scroll-thin flex h-full w-[232px] flex-none flex-col overflow-y-auto border-r border-divider bg-white">
      <div className="border-b border-divider px-3 py-3">
        <div className="kicker">{t("nav.title")}</div>
        <div className="text-sm">{t("guide.progress", { done: doneCount, total: AREA_ORDER.length })}</div>
        <div className="mt-2 h-1 bg-paper">
          <div
            className="h-1 bg-accent transition-all"
            style={{ width: `${(doneCount / AREA_ORDER.length) * 100}%` }}
          />
        </div>
      </div>

      {AREA_GROUPS.map((group) => {
        const closed = collapsed[group.id];
        const groupDone = group.areas.filter((a) => isAreaDone(a, config, layout, confirmed)).length;
        return (
          <div key={group.id} className="border-b border-divider">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !closed }))}
              aria-expanded={!closed}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-paper"
            >
              <span className={cx("text-[10px] text-muted transition-transform", closed ? "-rotate-90" : "")}>▾</span>
              <span className="flex-1 text-[13px] font-medium">{t(`group.${group.id}`)}</span>
              <span className="kicker">
                {groupDone}/{group.areas.length}
              </span>
            </button>
            {closed ? null : (
              <ul className="pb-1">
                {group.areas.map((id) => {
                  const done = isAreaDone(id, config, layout, confirmed);
                  const active = area === id && !selectedId;
                  const isNext = id === next;
                  return (
                    <li key={id}>
                      <Tip block side="right" title={t(`area.${id}.title`)} body={t(`area.${id}.why`)}>
                        <button
                          onClick={() => setArea(id)}
                          aria-current={active ? "page" : undefined}
                          className={cx(
                            "flex w-full items-start gap-2 border-l-2 py-1.5 pl-4 pr-3 text-left",
                            active ? "border-accent bg-accent/10" : "border-transparent hover:bg-paper",
                          )}
                        >
                          <span
                            className={cx(
                              "num mt-0.5 flex h-4 w-4 flex-none items-center justify-center border text-[10px]",
                              done
                                ? "border-accent bg-accent text-white"
                                : isNext
                                  ? "border-accent text-accent"
                                  : "border-divider text-muted",
                            )}
                          >
                            {done ? "✓" : AREA_ORDER.indexOf(id) + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className={cx("truncate text-[13px]", active && "text-accent")}>
                                {t(`area.${id}.title`)}
                              </span>
                              {isNext ? (
                                <span className="kicker border border-accent px-1 text-[9px] text-accent">
                                  {t("guide.next")}
                                </span>
                              ) : null}
                            </span>
                            <span className="num block truncate text-[11px] text-muted">{status[id]}</span>
                          </span>
                        </button>
                      </Tip>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
