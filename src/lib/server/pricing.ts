import "server-only";
import { getMachine } from "@/lib/library";
import { effectiveMachine } from "@/lib/solver";
import { PRICE_BOOK } from "./pricebook";
import type { Configuration } from "@/lib/types";

export type Role = "guest" | "sales";

export type QuoteLine = {
  instanceId: string;
  pos: number;
  machineId: string;
  sku: string;
  name: string;
  quantity: number;
  optionNames: string[];
  /** Endast i säljläge. */
  listPrice?: number;
  optionsPrice?: number;
  rowTotal?: number;
};

export type PriceResult = {
  role: Role;
  priceBookId: string;
  priceBookName: string;
  validUntil: string;
  currency: "SEK";
  lines: QuoteLine[];
  /** Publikt: null. Säljläge: exakta belopp. */
  totals: {
    machines: number;
    install: number;
    control: number;
    freight: number;
    grandTotal: number;
    cost: number;
    margin: number;
    marginPercent: number;
  } | null;
  /** Alltid tillgängligt: indikativt intervall. */
  indication: { lowSek: number; highSek: number };
  note: string;
};

/**
 * Beräknar pris på servern. Klienten får aldrig prisboken — bara resultatet,
 * och exakta belopp bara när rollen tillåter det.
 */
export function priceConfiguration(config: Configuration, role: Role): PriceResult {
  const lines: QuoteLine[] = [];
  let machines = 0;
  let install = 0;
  let cost = 0;

  config.line.forEach((item, index) => {
    const machine = getMachine(item.machineId);
    if (!machine) return;
    const entry = PRICE_BOOK.entries[machine.id];
    if (!entry) return;

    const eff = effectiveMachine(
      machine,
      item.selectedOptions,
      machine.parametricLength ? config.flow.finalConveyorLengthMm : undefined,
    );

    // Parametriska maskiner prissätts per löpmeter ovanpå grundpriset.
    const lengthPrice = machine.parametricLength
      ? Math.round((eff.effLengthMm / 1000) * machine.parametricLength.pricePerMeter)
      : 0;

    const optionsPrice = item.selectedOptions.reduce(
      (sum, optId) => sum + (entry.options[optId] ?? 0),
      0,
    );

    const listPrice = entry.list + lengthPrice;
    const rowTotal = listPrice + optionsPrice;
    const factor = PRICE_BOOK.installFactor[machine.category] ?? 0.12;

    machines += rowTotal;
    install += Math.round(rowTotal * factor);
    cost += entry.cost + Math.round(lengthPrice * 0.62) + Math.round(optionsPrice * 0.64);

    lines.push({
      instanceId: item.instanceId,
      pos: index + 1,
      machineId: machine.id,
      sku: machine.sku,
      name: machine.name,
      quantity: 1,
      optionNames: item.selectedOptions
        .map((id) => machine.options.find((o) => o.id === id)?.name)
        .filter((n): n is string => !!n),
      ...(role === "sales" ? { listPrice, optionsPrice, rowTotal } : {}),
    });
  });

  const control = Math.round(machines * PRICE_BOOK.controlFactor);
  const freight = machines > 0 ? PRICE_BOOK.freight : 0;
  const grandTotal = machines + install + control + freight;
  const margin = grandTotal - cost;

  return {
    role,
    priceBookId: PRICE_BOOK.id,
    priceBookName: PRICE_BOOK.name,
    validUntil: PRICE_BOOK.validUntil,
    currency: "SEK",
    lines,
    totals:
      role === "sales"
        ? {
            machines,
            install,
            control,
            freight,
            grandTotal,
            cost,
            margin,
            marginPercent: grandTotal > 0 ? Math.round((margin / grandTotal) * 1000) / 10 : 0,
          }
        : null,
    indication: {
      lowSek: Math.round(grandTotal * PRICE_BOOK.indicationSpread.low),
      highSek: Math.round(grandTotal * PRICE_BOOK.indicationSpread.high),
    },
    note:
      role === "sales"
        ? `Listpris enligt ${PRICE_BOOK.name}, exkl. moms. Montage och styr ingår som påslag.`
        : "Prisindikation ±20 %, ej bindande offert.",
  };
}
