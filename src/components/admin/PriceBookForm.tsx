"use client";

import { CATEGORY_LABEL } from "@/lib/library";
import { CATEGORIES } from "@/lib/machineSchema";
import { Grid, NumField, Panel, TextField } from "./fields";
import type { PriceBook } from "@/lib/server/pricebook";
import type { MachineCategory } from "@/lib/types";

export function PriceBookForm({
  priceBook,
  onChange,
}: {
  priceBook: PriceBook;
  onChange: (priceBook: PriceBook) => void;
}) {
  const set = <K extends keyof PriceBook>(key: K, value: PriceBook[K]) =>
    onChange({ ...priceBook, [key]: value });

  return (
    <div>
      <h2 className="mb-4 text-xl">Prisbok</h2>

      <Panel title="Identitet" description="Visas i offertunderlaget.">
        <Grid cols={4}>
          <TextField label="Id" mono value={priceBook.id} onChange={(v) => set("id", v)} />
          <TextField label="Namn" value={priceBook.name} onChange={(v) => set("name", v)} />
          <TextField
            label="Giltig från"
            mono
            value={priceBook.validFrom}
            onChange={(v) => set("validFrom", v)}
          />
          <TextField
            label="Giltig till"
            mono
            value={priceBook.validUntil}
            onChange={(v) => set("validUntil", v)}
          />
        </Grid>
      </Panel>

      <Panel
        title="Montagepåslag per kategori"
        description="Andel av maskinvärdet. 0,15 betyder 15 % påslag."
      >
        <Grid cols={4}>
          {CATEGORIES.map((category) => (
            <NumField
              key={category}
              label={CATEGORY_LABEL[category as MachineCategory]}
              step={0.01}
              min={0}
              max={3}
              value={priceBook.installFactor[category] ?? 0}
              onChange={(v) =>
                set("installFactor", { ...priceBook.installFactor, [category]: v })
              }
            />
          ))}
        </Grid>
      </Panel>

      <Panel title="Övriga påslag">
        <Grid cols={4}>
          <NumField
            label="El och styr"
            hint="andel av maskinvärdet"
            step={0.01}
            min={0}
            max={3}
            value={priceBook.controlFactor}
            onChange={(v) => set("controlFactor", v)}
          />
          <NumField
            label="Frakt"
            unit="kr"
            value={priceBook.freight}
            onChange={(v) => set("freight", v)}
          />
          <NumField
            label="Indikation låg"
            hint="faktor, t.ex. 0,87"
            step={0.01}
            min={0.1}
            max={1}
            value={priceBook.indicationSpread.low}
            onChange={(v) =>
              set("indicationSpread", { ...priceBook.indicationSpread, low: v })
            }
          />
          <NumField
            label="Indikation hög"
            hint="faktor, t.ex. 1,14"
            step={0.01}
            min={1}
            max={5}
            value={priceBook.indicationSpread.high}
            onChange={(v) =>
              set("indicationSpread", { ...priceBook.indicationSpread, high: v })
            }
          />
        </Grid>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Intervallet är det enda pris en icke inloggad besökare ser. Maskinpriserna redigeras på
          respektive maskin.
        </p>
      </Panel>
    </div>
  );
}
