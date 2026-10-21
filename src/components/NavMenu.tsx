"use client";

import { useConfigStore } from "@/store/useConfigStore";
import {
  AREA_ORDER,
  COUNTED,
  OPTIONAL,
  areaNumber,
  firstOpenArea,
  isAreaDone,
  type Area,
} from "@/lib/areas";
import { meters } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cx, Tip } from "./ui";

/**
 * Menyn till vänster: var man är, vad som är klart och vad som är nästa steg.
 *
 * Tre steg plus ett valfritt, utan gruppnivå — grupperna var de verkliga
 * frågorna och är nu stegen. Varje steg har ett nummer som blir en bock när
 * det är klart, och en rad om vad som står i det just nu, så att man ser
 * läget utan att öppna något. Det valfria steget har streckad ruta och
 * räknas inte i mätaren: "1 av 3" ska gå att lita på.
 */
export function NavMenu() {
  const t = useT();
  const { config, layout, area, setArea, confirmedAreas, selectedId } =
    useConfigStore();
  const confirmed = new Set(confirmedAreas);

  const next = firstOpenArea(config, layout, confirmed);
  const doneCount = COUNTED.filter((a) =>
    isAreaDone(a, config, layout, confirmed),
  ).length;

  const count = (kind: string) =>
    config.drawn.filter((d) => d.kind === kind).length;
  const errors = layout.diagnostics.filter(
    (d) => d.severity === "error",
  ).length;
  const warnings = layout.diagnostics.filter(
    (d) => d.severity === "warning",
  ).length;

  /** En rad per steg, hopslagen ur det stegets innehåll. */
  const status: Record<Area, string> = {
    site: [
      `${meters(config.hall.lengthMm)} × ${meters(config.hall.widthMm)} m`,
      count("door") > 0
        ? t("nav.status.doors", { count: count("door") })
        : null,
      count("zone") > 0
        ? t("nav.status.zones", { count: count("zone") })
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    plant:
      config.line.length === 0
        ? t("nav.status.noMachines")
        : [
            t("nav.status.machines", { count: config.line.length }),
            errors + warnings === 0
              ? t("nav.status.lineOk")
              : t("nav.status.lineIssues", { errors, warnings }),
          ].join(" · "),
    product: `${t("area.optional")} · ${meters(config.product.packageWidthMinMm)}–${meters(
      config.product.packageWidthMaxMm,
    )} m · ${config.product.targetPackagesPerHour} pkt/h`,
    quote: t("nav.status.quote"),
  };

  return (
    <nav className="scroll-thin flex h-full w-[232px] flex-none flex-col overflow-y-auto border-r border-divider bg-white">
      <div className="border-b border-divider px-3 py-3">
        <div className="kicker">{t("nav.title")}</div>
        <div className="text-sm">
          {t("guide.progress", { done: doneCount, total: COUNTED.length })}
        </div>
        <div className="mt-2 h-1 bg-paper">
          <div
            className="h-1 bg-accent transition-all"
            style={{ width: `${(doneCount / COUNTED.length) * 100}%` }}
          />
        </div>
      </div>

      <ul className="py-1">
        {AREA_ORDER.map((id) => {
          const done = isAreaDone(id, config, layout, confirmed);
          const active = area === id && !selectedId;
          const isNext = id === next;
          const optional = OPTIONAL.has(id);
          const n = areaNumber(id);
          return (
            <li key={id}>
              <Tip
                block
                side="right"
                title={t(`area.${id}.title`)}
                body={t(`area.${id}.why`)}
              >
                <button
                  onClick={() => setArea(id)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex w-full items-start gap-2 border-l-2 py-1.5 pl-3 pr-3 text-left",
                    active
                      ? "border-accent bg-accent/10"
                      : "border-transparent hover:bg-paper",
                  )}
                >
                  <span
                    className={cx(
                      "num mt-0.5 flex h-4 w-4 flex-none items-center justify-center border text-[10px]",
                      optional && !done && "border-dashed",
                      done
                        ? "border-accent bg-accent text-white"
                        : isNext
                          ? "border-accent text-accent"
                          : "border-divider text-muted",
                    )}
                  >
                    {done ? "✓" : (n ?? "·")}
                  </span>
                  <span
                    className={cx("min-w-0 flex-1", optional && "opacity-80")}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cx(
                          "truncate text-[13px]",
                          active && "text-accent",
                        )}
                      >
                        {t(`area.${id}.title`)}
                      </span>
                      {isNext ? (
                        <span className="kicker border border-accent px-1 text-[9px] text-accent">
                          {t("guide.next")}
                        </span>
                      ) : null}
                      {optional ? (
                        <span className="kicker border border-divider px-1 text-[9px] text-muted">
                          {t("area.optional")}
                        </span>
                      ) : null}
                    </span>
                    <span className="num block truncate text-[11px] text-muted">
                      {status[id]}
                    </span>
                  </span>
                </button>
              </Tip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
