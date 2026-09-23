"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { countBySeverity } from "@/lib/layout";
import { meters, mkr } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { PriceResult } from "@/lib/server/pricing";

export function StatusBar({ price }: { price: PriceResult | null }) {
  const { layout, toggleDiagnostics } = useConfigStore();
  const t = useT();
  const { errors, warnings } = countBySeverity(layout);
  const metrics = layout.metrics;

  /*
   * Ingen prisruta utan belopp. Förut stod ett intervall här för alla —
   * "2,6–3,4 Mkr" utan inloggning — och ett intervall är ett pris.
   */
  const priceLabel = price?.totals
    ? mkr(price.totals.grandTotal)
    : price?.indication
      ? `${mkr(price.indication.lowSek)}–${mkr(price.indication.highSek)}`
      : null;

  return (
    <div className="flex h-9 flex-none items-center gap-5 border-t border-divider bg-ink px-3 text-paper">
      <Item
        label={t("status.size")}
        value={`L ${meters(metrics.totalLengthMm)} m · B ${meters(metrics.totalWidthMm)} m · H ${meters(metrics.maxHeightMm)} m`}
      />
      <Item label={t("status.area")} value={`${metrics.footprintM2} m²`} />
      <Item
        label={t("status.capacity")}
        value={metrics.throughputPerHour > 0 ? `${metrics.throughputPerHour} pkt/h` : "—"}
      />
      {metrics.bottleneck ? (
        <span className="hidden text-[11px] text-paper/60 lg:inline">
          {t("status.bottleneck", { name: metrics.bottleneck.name })}
        </span>
      ) : null}

      <button
        onClick={() => toggleDiagnostics(true)}
        className={`num border px-2 py-0.5 text-xs transition-colors ${
          errors > 0
            ? "border-danger bg-danger text-white"
            : warnings > 0
              ? "border-warn text-warn hover:bg-warn hover:text-white"
              : "border-paper/30 text-paper/70 hover:border-paper"
        }`}
      >
        {errors > 0
          ? warnings > 0
            ? t("status.errorsAndWarnings", { errors, warnings })
            : t("status.errors", { count: errors })
          : warnings > 0
            ? t("status.warnings", { count: warnings })
            : t("status.noIssues")}
      </button>

      {priceLabel ? (
        <div className="ml-auto flex items-baseline gap-2">
          <span className="kicker text-paper/50">
            {price?.totals ? t("status.listPrice") : t("status.priceRange")}
          </span>
          <span className="num text-sm">{priceLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="kicker text-paper/50">{label}</span>
      <span className="num text-xs">{value}</span>
    </div>
  );
}
