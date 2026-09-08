import "server-only";
import { BUILTIN_LIBRARY, getMachine, type MachineLibrary } from "@/lib/library";
import { effectiveMachine } from "@/lib/solver";
import { BUILTIN_PRICE_BOOK, type PriceBook } from "./pricebook";
import type { Configuration } from "@/lib/types";

export type Role = "guest" | "customer" | "sales" | "admin";

/** Roller som får se exakta belopp. */
export const canSeePrices = (role: Role) => role === "sales" || role === "admin";

export type QuoteLine = {
  instanceId: string;
  pos: number;
  machineId: string;
  sku: string;
  name: string;
  quantity: number;
  optionNames: string[];
  /** Kundens parametrar, som text för offertunderlaget. */
  parameterLines: string[];
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
export function priceConfiguration(
  config: Configuration,
  role: Role,
  library: MachineLibrary = BUILTIN_LIBRARY,
  priceBook: PriceBook = BUILTIN_PRICE_BOOK,
): PriceResult {
  const showPrices = canSeePrices(role);
  const lines: QuoteLine[] = [];
  let machines = 0;
  let install = 0;
  let cost = 0;

  config.line.forEach((item, index) => {
    const machine = getMachine(item.machineId, library);
    if (!machine) return;
    const entry = priceBook.entries[machine.id];
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

    // Kundens parametrar kan bära pris: per enhet, per val eller vid påslag.
    const parameterLines: string[] = [];
    let parametersPrice = 0;
    for (const parameter of machine.parameters ?? []) {
      const raw = item.parameters?.[parameter.id];

      if (parameter.type === "number") {
        const value = typeof raw === "number" ? raw : parameter.defaultNumber;
        if (typeof value !== "number") continue;
        parametersPrice += Math.round((parameter.pricePerUnit ?? 0) * value);
        parameterLines.push(`${parameter.label}: ${value}${parameter.unit ? ` ${parameter.unit}` : ""}`);
        continue;
      }

      if (parameter.type === "select") {
        const value = typeof raw === "string" ? raw : parameter.defaultText;
        const choice = parameter.choices?.find((c) => c.value === value);
        if (!choice) continue;
        parametersPrice += choice.priceDelta ?? 0;
        parameterLines.push(`${parameter.label}: ${choice.label}`);
        continue;
      }

      const value = typeof raw === "boolean" ? raw : (parameter.defaultBoolean ?? false);
      if (value) parametersPrice += parameter.priceWhenTrue ?? 0;
      parameterLines.push(`${parameter.label}: ${value ? "Ja" : "Nej"}`);
    }

    const listPrice = entry.list + lengthPrice;
    const rowTotal = listPrice + optionsPrice + parametersPrice;
    const factor = priceBook.installFactor[machine.category] ?? 0.12;

    machines += rowTotal;
    install += Math.round(rowTotal * factor);
    cost +=
      entry.cost +
      Math.round(lengthPrice * 0.62) +
      Math.round((optionsPrice + parametersPrice) * 0.64);

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
      parameterLines,
      ...(showPrices ? { listPrice, optionsPrice: optionsPrice + parametersPrice, rowTotal } : {}),
    });
  });

  const control = Math.round(machines * priceBook.controlFactor);
  const freight = machines > 0 ? priceBook.freight : 0;
  const grandTotal = machines + install + control + freight;
  const margin = grandTotal - cost;

  return {
    role,
    priceBookId: priceBook.id,
    priceBookName: priceBook.name,
    validUntil: priceBook.validUntil,
    currency: "SEK",
    lines,
    totals: showPrices
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
      lowSek: Math.round(grandTotal * priceBook.indicationSpread.low),
      highSek: Math.round(grandTotal * priceBook.indicationSpread.high),
    },
    note: showPrices
      ? `Listpris enligt ${priceBook.name}, exkl. moms. Montage och styr ingår som påslag.`
      : "Prisindikation ±20 %, ej bindande offert.",
  };
}
