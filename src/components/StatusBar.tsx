"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { countBySeverity } from "@/lib/layout";
import { meters, mkr } from "@/lib/format";
import type { PriceResult } from "@/lib/server/pricing";

export function StatusBar({ price }: { price: PriceResult | null }) {
  const { layout, toggleDiagnostics } = useConfigStore();
  const { errors, warnings } = countBySeverity(layout);
  const metrics = layout.metrics;

  const priceLabel = !price
    ? "—"
    : price.totals
      ? mkr(price.totals.grandTotal)
      : `${mkr(price.indication.lowSek)}–${mkr(price.indication.highSek)}`;

  return (
    <div className="flex h-9 flex-none items-center gap-5 border-t border-divider bg-ink px-3 text-paper">
      <Item
        label="Mått"
        value={`L ${meters(metrics.totalLengthMm)} m · B ${meters(metrics.totalWidthMm)} m · H ${meters(metrics.maxHeightMm)} m`}
      />
      <Item label="Yta" value={`${metrics.footprintM2} m²`} />
      <Item
        label="Kapacitet"
        value={metrics.throughputPerHour > 0 ? `${metrics.throughputPerHour} pkt/h` : "—"}
      />
      {metrics.bottleneck ? (
        <span className="hidden text-[11px] text-paper/60 lg:inline">
          Flaskhals: {metrics.bottleneck.name}
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
          ? `${errors} fel${warnings > 0 ? ` · ${warnings} varn.` : ""}`
          : warnings > 0
            ? `${warnings} varningar`
            : "Inga anmärkningar"}
      </button>

      <div className="ml-auto flex items-baseline gap-2">
        <span className="kicker text-paper/50">
          {price?.totals ? "Listpris" : "Prisintervall"}
        </span>
        <span className="num text-sm">{priceLabel}</span>
      </div>
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
