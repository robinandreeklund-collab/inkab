"use client";

import { useRef, useState } from "react";
import { Button, Tag } from "../ui";
import { Grid, NumField, Panel, TextField } from "./fields";
import { DEFAULT_ORIENTATION, orientedFootprint, type ModelOrientation } from "@/lib/cad/orientation";
import { collectIssues, variantSchema } from "@/lib/machineSchema";
import { STAGE_TEXT, useStepConversion } from "./useStepConversion";
import type { Machine, MachineVariant } from "@/lib/types";
import type { PriceEntry } from "@/lib/server/pricebook";

/**
 * Utföranden: samma maskin i olika längder.
 *
 * En rullbana finns som 3, 6 och 12 meter. Det är inte tre maskiner i
 * biblioteket utan en maskin med tre mått — samma beskrivning, samma
 * optioner, samma regler. Varje utförande bär sin egen STEP-fil, och måtten
 * kommer ur den. Kunden väljer utförande i konfiguratorn.
 *
 * Priset ligger i prisboken, aldrig i utförandet: maskinbiblioteket går till
 * webbläsaren, prisboken gör det aldrig.
 */

/** Bara talet; enheten skrivs en gång efter det sista måttet. */
const m = (mm: number) => (mm / 1000).toFixed(2).replace(".", ",");
const meters = (mm: number) => `${m(mm)} m`;

export function VariantPanel({
  machine,
  modelDefaults,
  price,
  onChange,
  onPriceChange,
}: {
  machine: Machine;
  modelDefaults: ModelOrientation | undefined;
  price: PriceEntry;
  onChange: (machine: Machine) => void;
  onPriceChange: (price: PriceEntry) => void;
}) {
  const variants = machine.variants ?? [];

  const add = () => {
    const next: MachineVariant = {
      id: `v${Date.now().toString(36).slice(-4)}`,
      name: `${variants.length + 1}`,
      // Utgår från maskinens mått tills en STEP-fil ger de riktiga.
      footprint: { ...machine.footprint },
    };
    onChange({ ...machine, variants: [...variants, next] });
  };

  const update = (id: string, patch: Partial<MachineVariant>) =>
    onChange({
      ...machine,
      variants: variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });

  const remove = (id: string) => {
    const rest = variants.filter((v) => v.id !== id);
    onChange({ ...machine, variants: rest.length > 0 ? rest : undefined });
    const { [id]: _removed, ...keptPrices } = price.variants ?? {};
    onPriceChange({ ...price, variants: Object.keys(keptPrices).length ? keptPrices : undefined });
  };

  return (
    <Panel
      title="Utföranden"
      description="Samma maskin i olika längder. Kunden väljer i konfiguratorn."
      action={
        <Button size="sm" disabled={variants.length >= 12} onClick={add}>
          + Utförande
        </Button>
      }
    >
      {machine.parametricLength && variants.length > 0 ? (
        <p className="mb-3 border border-warn px-2 py-1 text-xs text-warn">
          Maskinen har också steglös längd ({machine.parametricLength.minMm / 1000}–
          {machine.parametricLength.maxMm / 1000} m). Utförandena tar över — det är de
          längderna som levereras. Vill du ha steglös längd i stället, ta bort utförandena.
        </p>
      ) : null}

      {variants.length === 0 ? (
        <p className="border border-dashed border-divider px-3 py-4 text-xs leading-relaxed text-muted">
          Inga utföranden. Maskinen används då med sina egna mått.
          <br />
          Lägg till ett utförande per längd som finns att köpa — 3 m, 6 m, 12 m. Ladda upp en
          STEP-fil på raden så hämtas måtten ur den, eller skriv längden för hand om modellen
          inte finns än. Kunden väljer sedan utförande i konfiguratorn.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[11px] leading-relaxed text-muted">
            Det första utförandet är det kunden får som förval. Priset gäller i stället för
            maskinens grundpris; lämnas det på noll används grundpriset.
          </p>
          <div className="space-y-3">
            {variants.map((variant, index) => (
              <VariantRow
                key={variant.id}
                machine={machine}
                modelDefaults={modelDefaults}
                variant={variant}
                isDefault={index === 0}
                price={price.variants?.[variant.id]}
                onChange={(patch) => update(variant.id, patch)}
                onPriceChange={(entry) =>
                  onPriceChange({
                    ...price,
                    variants: { ...(price.variants ?? {}), [variant.id]: entry },
                  })
                }
                onRemove={() => remove(variant.id)}
              />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function VariantRow({
  machine,
  modelDefaults,
  variant,
  isDefault,
  price,
  onChange,
  onPriceChange,
  onRemove,
}: {
  machine: Machine;
  modelDefaults: ModelOrientation | undefined;
  variant: MachineVariant;
  isDefault: boolean;
  price?: { list: number; cost: number };
  onChange: (patch: Partial<MachineVariant>) => void;
  onPriceChange: (entry: { list: number; cost: number }) => void;
  onRemove: () => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { convert, stage, elapsed, busy, error } = useStepConversion();
  const [note, setNote] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const run = async (file: File) => {
    setNote(null);
    const converted = await convert(file, `${machine.id}-${variant.id}`, {
      toleranceMm: 2,
      minPartMm: 50,
      proxy: true,
    });
    if (!converted) return;

    // Riktningen kommer ur bibliotekets inställning. Alla filer ur samma CAD
    // delar konvention, så det är ingenting att räkna fram per utförande.
    const orientation: ModelOrientation = modelDefaults ?? DEFAULT_ORIENTATION;

    const footprint = orientedFootprint(converted.footprint, orientation);
    const model = { glb: converted.model.glb, proxy: converted.model.proxy, ...orientation };

    // Samma grind som basmaskinen: mått som inte går att spara skrivs inte
    // in. En modell i fel längdenhet ger en 8 cm bred maskin, och det ska
    // sägas här i stället för att upptäckas som en vägran att spara.
    const candidate = { ...variant, footprint, model, dimensionsVerified: false };
    const parsed = variantSchema.safeParse(candidate);
    if (!parsed.success) {
      onChange({ model });
      setIssues(collectIssues(parsed.error).map((i) => `${i.path}: ${i.message}`));
      setNote(null);
      return;
    }

    setIssues([]);
    onChange({
      footprint,
      model,
      dimensionsVerified: false,
      // Namnet följer längden om ingen döpt utförandet till något eget.
      ...(/^\d+$/.test(variant.name) ? { name: `${meters(footprint.lengthMm)}` } : {}),
    });
    setNote(
      `Måtten hämtade ur modellen: ${m(footprint.lengthMm)} × ` +
        `${m(footprint.widthMm)} × ${meters(footprint.heightMm)}.`,
    );
  };

  return (
    <div className="border border-divider p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="kicker">Utförande</span>
        {isDefault ? <Tag tone="accent">förval</Tag> : null}
        {variant.model?.glb ? <Tag>3D-modell</Tag> : <Tag tone="warn">ingen modell</Tag>}
        <span className="num ml-auto text-[11px] text-muted">
          {m(variant.footprint.lengthMm)} × {m(variant.footprint.widthMm)} ×{" "}
          {meters(variant.footprint.heightMm)}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".step,.stp,.STEP,.STP"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) run(file);
            e.target.value = "";
          }}
        />
        <Button size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? `${STAGE_TEXT[stage!] ?? "Arbetar"}… ${elapsed} s` : "STEP-fil"}
        </Button>
        <button onClick={onRemove} className="text-muted hover:text-danger" aria-label="Ta bort">
          ×
        </button>
      </div>

      {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
      {note ? <p className="mb-2 text-xs text-accent">{note}</p> : null}
      {issues.length > 0 ? (
        <div className="mb-2 border border-danger px-2 py-1 text-xs text-danger">
          <p className="mb-1">
            Måtten ur modellen går inte att spara. Måtten är oförändrade; modellen är inlagd.
          </p>
          <ul className="ml-4 list-disc">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Grid cols={4}>
        <TextField
          label="Benämning"
          hint="visas för kund"
          value={variant.name}
          placeholder="6 m"
          onChange={(v) => onChange({ name: v })}
        />
        <NumField
          label="Längd"
          asMeters
          value={variant.footprint.lengthMm}
          onChange={(v) => onChange({ footprint: { ...variant.footprint, lengthMm: v } })}
        />
        <NumField
          label="Listpris"
          unit="kr"
          hint="0 = maskinens grundpris"
          value={price?.list ?? 0}
          onChange={(v) => onPriceChange({ list: v, cost: price?.cost ?? 0 })}
        />
        <NumField
          label="Inköpspris"
          unit="kr"
          value={price?.cost ?? 0}
          onChange={(v) => onPriceChange({ list: price?.list ?? 0, cost: v })}
        />
      </Grid>
    </div>
  );
}
