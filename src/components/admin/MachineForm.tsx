"use client";

import { useState } from "react";
import { CATEGORY_LABEL } from "@/lib/library";
import { CATEGORIES } from "@/lib/machineSchema";
import { Button, Tag } from "../ui";
import { MachinePreview } from "./MachinePreview";
import { ParameterPanel } from "./ParameterPanel";
import { ImagePanel } from "./ImagePanel";
import { ModelPanel } from "./ModelPanel";
import {
  CheckField,
  Grid,
  IssueList,
  MultiSelect,
  NumField,
  Panel,
  SelectField,
  TextArea,
  TextField,
} from "./fields";
import type { Dir, Machine, MachineCategory, Port, Zone } from "@/lib/types";

const DIRECTION_OPTIONS: { value: Dir; label: string }[] = [
  { value: "x+", label: "X+ (framåt)" },
  { value: "x-", label: "X− (bakåt)" },
  { value: "y+", label: "Y+ (höger)" },
  { value: "y-", label: "Y− (vänster)" },
];
import type { PriceEntry } from "@/lib/server/pricebook";
import type { LibraryAsset } from "@/lib/machineSchema";

type ValidationResult = {
  ok: boolean;
  issues: { path: string; message: string }[];
  note?: string;
  placed?: { rotation: number; mirrored: boolean } | null;
};

export function MachineForm({
  machine,
  price,
  allMachines,
  assets,
  onChange,
  onPriceChange,
  onAssetsChange,
  onDelete,
  onDuplicate,
}: {
  machine: Machine;
  price: PriceEntry;
  allMachines: Machine[];
  assets: LibraryAsset[];
  onChange: (machine: Machine) => void;
  onPriceChange: (price: PriceEntry) => void;
  onAssetsChange: (assets: LibraryAsset[]) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  const set = <K extends keyof Machine>(key: K, value: Machine[K]) =>
    onChange({ ...machine, [key]: value });

  const others = allMachines
    .filter((m) => m.id !== machine.id)
    .map((m) => ({ value: m.id, label: `${m.name} (${m.id})` }));

  const validate = async () => {
    setValidating(true);
    try {
      const response = await fetch("/api/admin/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machine }),
      });
      setValidation(await response.json());
    } catch {
      setValidation({ ok: false, issues: [{ path: "", message: "Kunde inte nå servern." }] });
    } finally {
      setValidating(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-xl">{machine.name || "Namnlös maskin"}</h2>
        <Tag tone="muted">{machine.id}</Tag>
        {machine.catalogueNumber && machine.catalogueNumber !== "—" ? (
          <Tag tone="accent">Katalog {machine.catalogueNumber}</Tag>
        ) : null}
        {machine.aux ? <Tag tone="accent">Hjälpobjekt</Tag> : null}
        {machine.dimensionsVerified ? null : <Tag tone="warn">Uppskattade mått</Tag>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={validate} disabled={validating}>
            {validating ? "Provkopplar…" : "Provkoppla"}
          </Button>
          <Button size="sm" onClick={onDuplicate}>
            Duplicera
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Ta bort
          </Button>
        </div>
      </div>

      {validation ? (
        <div
          className={`mb-4 border p-2 text-xs ${
            validation.ok ? "border-accent text-accent" : "border-danger text-danger"
          }`}
        >
          <strong>{validation.ok ? "Provkopplingen lyckades." : "Provkopplingen misslyckades."}</strong>{" "}
          {validation.note}
          {validation.issues.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {validation.issues.map((issue, i) => (
                <li key={i}>
                  <span className="num mr-2 opacity-70">{issue.path}</span>
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <Panel title="Identitet">
            <Grid cols={3}>
              <TextField
                label="Id"
                value={machine.id}
                mono
                hint="gemener, siffror, bindestreck"
                onChange={(v) => set("id", v)}
              />
              <TextField label="Artikelnummer" value={machine.sku} onChange={(v) => set("sku", v)} />
              <TextField label="Namn" value={machine.name} onChange={(v) => set("name", v)} />
            </Grid>
            <div className="mt-3">
              <Grid cols={2}>
                <SelectField
                  label="Kategori"
                  value={machine.category}
                  options={CATEGORIES.map((c) => ({
                    value: c as MachineCategory,
                    label: CATEGORY_LABEL[c as MachineCategory],
                  }))}
                  onChange={(v) => set("category", v)}
                />
                <TextField
                  label="STEP-fil"
                  value={machine.stepFile ?? ""}
                  hint="filnamn"
                  onChange={(v) => set("stepFile", v || undefined)}
                />
              </Grid>
            </div>
            <div className="mt-3">
              <TextArea
                label="Kort beskrivning"
                value={machine.summary}
                rows={2}
                onChange={(v) => set("summary", v)}
              />
            </div>
            <div className="mt-3">
              <TextArea
                label="Maskinbeskrivning för assistenten"
                value={machine.aiDescription ?? ""}
                rows={10}
                onChange={(v) => set("aiDescription", v || undefined)}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Läggs in i assistentens systemprompt i sin helhet. Skriv vad maskinen gör, vilket
                problem den löser, hur den fungerar i praktiken, vad den kräver och när den ska
                väljas framför ett alternativ. Det är härifrån assistenten vet vad maskinen är.
              </p>
            </div>
            <div className="mt-3">
              <Grid cols={2}>
                <TextField
                  label="Katalognummer"
                  value={machine.catalogueNumber ?? ""}
                  hint="ur produktkatalogen"
                  onChange={(v) => set("catalogueNumber", v || undefined)}
                />
                <div className="flex items-end">
                  <CheckField
                    label="Måtten är kontrollerade mot ritning"
                    hint="Avmarkerad betyder uppskattade mått som inte får visas för kund utan förbehåll."
                    checked={!!machine.dimensionsVerified}
                    onChange={(v) => set("dimensionsVerified", v || undefined)}
                  />
                </div>
              </Grid>
            </div>
            <div className="mt-2">
              <CheckField
                label="Hjälpobjekt"
                hint="Ingår inte i produktionskedjan. Placeras bredvid sin ankarmaskin, t.ex. pulpet och ströfacksmagasin."
                checked={!!machine.aux}
                onChange={(v) => onChange({ ...machine, aux: v || undefined, ports: v ? [] : machine.ports })}
              />
              {machine.aux ? (
                <div className="mt-2 max-w-xs">
                  <SelectField
                    label="Placeras vid"
                    value={machine.anchorFor ?? ""}
                    hint="ankarmaskin"
                    options={[
                      { value: "", label: "Automatiskt (mest manuella stationen)" },
                      ...others,
                    ]}
                    onChange={(v) => set("anchorFor", v || undefined)}
                  />
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel title="Geometri" description="Yttermått i meter. Lagras som heltal millimeter.">
            <Grid cols={3}>
              <NumField
                label="Längd"
                asMeters
                value={machine.footprint.lengthMm}
                onChange={(v) => set("footprint", { ...machine.footprint, lengthMm: v })}
              />
              <NumField
                label="Bredd"
                asMeters
                value={machine.footprint.widthMm}
                onChange={(v) => set("footprint", { ...machine.footprint, widthMm: v })}
              />
              <NumField
                label="Höjd"
                asMeters
                value={machine.footprint.heightMm}
                onChange={(v) => set("footprint", { ...machine.footprint, heightMm: v })}
              />
            </Grid>
            <div className="mt-2">
              <CheckField
                label="Kan speglas"
                hint="Solvern speglar maskinen när pulpeten ska stå på andra sidan."
                checked={machine.mirrorable}
                onChange={(v) => set("mirrorable", v)}
              />
              <CheckField
                label="Valfri längd"
                hint="Längden styrs av kundens svar på frågan om sista kedjetransportören."
                checked={!!machine.parametricLength}
                onChange={(v) =>
                  set(
                    "parametricLength",
                    v ? { minMm: 3000, maxMm: 30000, pricePerMeter: 24000 } : undefined,
                  )
                }
              />
            </div>
            {machine.parametricLength ? (
              <div className="mt-3">
                <Grid cols={3}>
                  <NumField
                    label="Minlängd"
                    asMeters
                    value={machine.parametricLength.minMm}
                    onChange={(v) =>
                      set("parametricLength", { ...machine.parametricLength!, minMm: v })
                    }
                  />
                  <NumField
                    label="Maxlängd"
                    asMeters
                    value={machine.parametricLength.maxMm}
                    onChange={(v) =>
                      set("parametricLength", { ...machine.parametricLength!, maxMm: v })
                    }
                  />
                  <NumField
                    label="Pris per meter"
                    unit="kr"
                    value={machine.parametricLength.pricePerMeter}
                    onChange={(v) =>
                      set("parametricLength", { ...machine.parametricLength!, pricePerMeter: v })
                    }
                  />
                </Grid>
              </div>
            ) : null}
            <div className="mt-4 border-t border-divider pt-3">
              <div className="kicker mb-1">Maskinzon</div>
              <p className="mb-2 text-[11px] leading-relaxed text-muted">
                Fritt utrymme som måste hållas runt maskinen. Inget får placeras innanför —
                regel R-106. Fram är i flödesriktningen. Solvern håller avstånden när linjen
                läggs ut, och grannen i kedjan undantas eftersom den är inkopplad port mot port.
              </p>
              <Grid cols={4}>
                {(
                  [
                    ["Fram", "frontMm"],
                    ["Bak", "backMm"],
                    ["Vänster", "leftMm"],
                    ["Höger", "rightMm"],
                  ] as const
                ).map(([label, key]) => (
                  <NumField
                    key={key}
                    label={label}
                    asMeters
                    value={machine.clearance?.[key] ?? 0}
                    onChange={(v) =>
                      set("clearance", {
                        frontMm: machine.clearance?.frontMm ?? 0,
                        backMm: machine.clearance?.backMm ?? 0,
                        leftMm: machine.clearance?.leftMm ?? 0,
                        rightMm: machine.clearance?.rightMm ?? 0,
                        [key]: Math.max(0, v),
                      })
                    }
                  />
                ))}
              </Grid>
            </div>

            {!machine.aux ? (
              <div className="mt-3 max-w-xs">
                <NumField
                  label="Operatörsprioritet"
                  hint="0–10, högre drar pulpeten hit"
                  value={machine.operatorPriority ?? 0}
                  min={0}
                  max={10}
                  onChange={(v) => set("operatorPriority", v || undefined)}
                />
              </div>
            ) : null}
          </Panel>

          {!machine.aux ? (
            <PortPanel machine={machine} onChange={(ports) => set("ports", ports)} />
          ) : null}

          <ZonePanel machine={machine} onChange={(zones) => set("zones", zones)} />

          <Panel title="Kapacitet och produkt">
            <Grid cols={2}>
              <NumField
                label="Kapacitet"
                unit="paket/h"
                value={machine.capacity.packagesPerHour}
                onChange={(v) => set("capacity", { ...machine.capacity, packagesPerHour: v })}
              />
              <NumField
                label="Max paketvikt"
                unit="kg"
                value={machine.capacity.maxWeightKg}
                onChange={(v) => set("capacity", { ...machine.capacity, maxWeightKg: v })}
              />
            </Grid>
            <div className="mt-3 space-y-3">
              {(
                [
                  ["Paketlängd", "packageLengthMm"],
                  ["Paketbredd", "packageWidthMm"],
                  ["Pakethöjd", "packageHeightMm"],
                ] as const
              ).map(([label, key]) => (
                <Grid key={key} cols={2}>
                  <NumField
                    label={`${label} min`}
                    asMeters
                    value={machine.capacity[key][0]}
                    onChange={(v) =>
                      set("capacity", {
                        ...machine.capacity,
                        [key]: [v, machine.capacity[key][1]] as [number, number],
                      })
                    }
                  />
                  <NumField
                    label={`${label} max`}
                    asMeters
                    value={machine.capacity[key][1]}
                    onChange={(v) =>
                      set("capacity", {
                        ...machine.capacity,
                        [key]: [machine.capacity[key][0], v] as [number, number],
                      })
                    }
                  />
                </Grid>
              ))}
            </div>
          </Panel>

          <Panel title="Media och fundament">
            <Grid cols={4}>
              <NumField
                label="Effekt"
                unit="kW"
                step={0.1}
                value={machine.utilities.powerKw}
                onChange={(v) => set("utilities", { ...machine.utilities, powerKw: v })}
              />
              <NumField
                label="Tryckluft"
                unit="Nl/min"
                value={machine.utilities.airNlPerMin}
                onChange={(v) => set("utilities", { ...machine.utilities, airNlPerMin: v })}
              />
              <NumField
                label="Gropdjup"
                unit="mm"
                value={machine.foundation.pitDepthMm}
                onChange={(v) => set("foundation", { ...machine.foundation, pitDepthMm: v })}
              />
              <NumField
                label="Punktlast"
                unit="kN"
                value={machine.foundation.pointLoadKn}
                onChange={(v) => set("foundation", { ...machine.foundation, pointLoadKn: v })}
              />
            </Grid>
            <div className="mt-3 max-w-xs">
              <NumField
                label="Leveranstid"
                unit="veckor"
                value={machine.leadTimeWeeks}
                onChange={(v) => set("leadTimeWeeks", v)}
              />
            </div>
          </Panel>

          <Panel title="Beroenden" description="Kontrolleras av regel R-501.">
            <Grid cols={2}>
              <MultiSelect
                label="Kräver"
                hint="måste finnas i linjen"
                values={machine.requires ?? []}
                options={others}
                onChange={(v) => set("requires", v.length ? v : undefined)}
              />
              <MultiSelect
                label="Kan inte kombineras med"
                values={machine.conflictsWith ?? []}
                options={others}
                onChange={(v) => set("conflictsWith", v.length ? v : undefined)}
              />
            </Grid>
          </Panel>

          <ParameterPanel machine={machine} onChange={(p) => set("parameters", p.length ? p : undefined)} />

          <ImagePanel
            machine={machine}
            assets={assets}
            onChange={onChange}
            onAssetsChange={onAssetsChange}
          />

          <ModelPanel machine={machine} onChange={onChange} />

          <OptionPanel machine={machine} price={price} onChange={onChange} onPriceChange={onPriceChange} />

          <Panel title="Pris" description="Listpris visas för säljare, inköpspris används för marginal.">
            <Grid cols={2}>
              <NumField
                label="Listpris"
                unit="kr"
                value={price.list}
                onChange={(v) => onPriceChange({ ...price, list: v })}
              />
              <NumField
                label="Inköpspris"
                unit="kr"
                value={price.cost}
                onChange={(v) => onPriceChange({ ...price, cost: v })}
              />
            </Grid>
            {machine.parametricLength ? (
              <p className="mt-2 text-[11px] text-muted">
                Maskinen har valfri längd. Listpriset är grundpriset; längden prissätts därutöver
                per löpmeter enligt fältet i geometrisektionen.
              </p>
            ) : null}
          </Panel>
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <h3 className="kicker mb-1">Förhandsgranskning</h3>
          <MachinePreview machine={machine} />
        </div>
      </div>
    </div>
  );
}

function PortPanel({
  machine,
  onChange,
}: {
  machine: Machine;
  onChange: (ports: Port[]) => void;
}) {
  const update = (index: number, patch: Partial<Port>) =>
    onChange(machine.ports.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const add = (role: "in" | "out") =>
    onChange([
      ...machine.ports,
      {
        id: role === "in" ? "in" : "out",
        role,
        pos: {
          x: role === "in" ? 0 : machine.footprint.lengthMm,
          y: Math.round(machine.footprint.widthMm / 2),
        },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 2400],
        allowsDirectionChange: false,
      },
    ]);

  return (
    <Panel
      title="Portar"
      description="Där paketet kommer in och lämnar. Solvern kopplar utport mot nästa maskins inport."
      action={
        <div className="flex gap-1">
          <Button size="sm" onClick={() => add("in")}>
            + Inport
          </Button>
          <Button size="sm" onClick={() => add("out")}>
            + Utport
          </Button>
        </div>
      }
    >
      {machine.ports.length === 0 ? (
        <p className="border border-dashed border-divider px-3 py-4 text-xs text-muted">
          Inga portar. En maskin i kedjan behöver minst en inport och en utport.
        </p>
      ) : (
        <div className="space-y-3">
          {machine.ports.map((port, index) => (
            <div key={index} className="border border-divider p-2">
              <div className="mb-2 flex items-center gap-2">
                <Tag tone={port.role === "in" ? "accent" : "muted"}>
                  {port.role === "in" ? "Inport" : "Utport"}
                </Tag>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => onChange(machine.ports.filter((_, i) => i !== index))}
                >
                  Ta bort
                </Button>
              </div>
              <Grid cols={4}>
                <TextField label="Id" value={port.id} mono onChange={(v) => update(index, { id: v })} />
                <NumField
                  label="X"
                  asMeters
                  value={port.pos.x}
                  onChange={(v) => update(index, { pos: { ...port.pos, x: v } })}
                />
                <NumField
                  label="Y"
                  asMeters
                  value={port.pos.y}
                  onChange={(v) => update(index, { pos: { ...port.pos, y: v } })}
                />
                <SelectField<Dir>
                  label="Riktning"
                  value={port.dir}
                  options={DIRECTION_OPTIONS}
                  onChange={(v) => update(index, { dir: v })}
                />
              </Grid>
              <div className="mt-2">
                <Grid cols={3}>
                  <NumField
                    label="Höjd över golv"
                    unit="mm"
                    value={port.levelMm}
                    onChange={(v) => update(index, { levelMm: v })}
                  />
                  <NumField
                    label="Produktbredd min"
                    unit="mm"
                    value={port.widthMm[0]}
                    onChange={(v) => update(index, { widthMm: [v, port.widthMm[1]] })}
                  />
                  <NumField
                    label="Produktbredd max"
                    unit="mm"
                    value={port.widthMm[1]}
                    onChange={(v) => update(index, { widthMm: [port.widthMm[0], v] })}
                  />
                </Grid>
              </div>
              <CheckField
                label="Kan vinkla flödet"
                hint="Sätts på utporten hos en tvärtransportör. Krävs när paketen kommer in från sidan."
                checked={port.allowsDirectionChange}
                onChange={(v) => update(index, { allowsDirectionChange: v })}
              />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ZonePanel({
  machine,
  onChange,
}: {
  machine: Machine;
  onChange: (zones: Zone[]) => void;
}) {
  const update = (index: number, patch: Partial<Zone>) =>
    onChange(machine.zones.map((z, i) => (i === index ? { ...z, ...patch } : z)));

  return (
    <Panel
      title="Zoner"
      description="Service- och skyddszoner i maskinens lokala system. Negativa värden ligger utanför fotavtrycket."
      action={
        <Button
          size="sm"
          onClick={() =>
            onChange([
              ...machine.zones,
              {
                type: "service",
                box: { x: 0, y: -1200, l: machine.footprint.lengthMm, w: 1200 },
                label: `Service ${machine.sku}`,
              },
            ])
          }
        >
          + Zon
        </Button>
      }
    >
      {machine.zones.length === 0 ? (
        <p className="border border-dashed border-divider px-3 py-4 text-xs text-muted">
          Inga zoner definierade.
        </p>
      ) : (
        <div className="space-y-2">
          {machine.zones.map((zone, index) => (
            <div key={index} className="border border-divider p-2">
              <Grid cols={3}>
                <SelectField
                  label="Typ"
                  value={zone.type}
                  options={[
                    { value: "service", label: "Servicezon" },
                    { value: "safety", label: "Skyddszon" },
                    { value: "pit", label: "Grop" },
                  ]}
                  onChange={(v) => update(index, { type: v })}
                />
                <TextField
                  label="Etikett"
                  value={zone.label}
                  onChange={(v) => update(index, { label: v })}
                />
                <div className="flex items-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange(machine.zones.filter((_, i) => i !== index))}
                  >
                    Ta bort
                  </Button>
                </div>
              </Grid>
              <div className="mt-2">
                <Grid cols={4}>
                  <NumField
                    label="X"
                    asMeters
                    value={zone.box.x}
                    onChange={(v) => update(index, { box: { ...zone.box, x: v } })}
                  />
                  <NumField
                    label="Y"
                    asMeters
                    value={zone.box.y}
                    onChange={(v) => update(index, { box: { ...zone.box, y: v } })}
                  />
                  <NumField
                    label="Längd"
                    asMeters
                    value={zone.box.l}
                    onChange={(v) => update(index, { box: { ...zone.box, l: v } })}
                  />
                  <NumField
                    label="Bredd"
                    asMeters
                    value={zone.box.w}
                    onChange={(v) => update(index, { box: { ...zone.box, w: v } })}
                  />
                </Grid>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function OptionPanel({
  machine,
  price,
  onChange,
  onPriceChange,
}: {
  machine: Machine;
  price: PriceEntry;
  onChange: (machine: Machine) => void;
  onPriceChange: (price: PriceEntry) => void;
}) {
  const update = (index: number, patch: Partial<Machine["options"][number]>) =>
    onChange({
      ...machine,
      options: machine.options.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    });

  return (
    <Panel
      title="Optioner"
      description="Tillval som ändrar mått, kapacitet, effekt eller pris."
      action={
        <Button
          size="sm"
          onClick={() =>
            onChange({
              ...machine,
              options: [
                ...machine.options,
                { id: `opt-${machine.options.length + 1}`, name: "Ny option" },
              ],
            })
          }
        >
          + Option
        </Button>
      }
    >
      {machine.options.length === 0 ? (
        <p className="border border-dashed border-divider px-3 py-4 text-xs text-muted">
          Inga optioner.
        </p>
      ) : (
        <div className="space-y-2">
          {machine.options.map((option, index) => (
            <div key={index} className="border border-divider p-2">
              <Grid cols={3}>
                <TextField label="Id" mono value={option.id} onChange={(v) => update(index, { id: v })} />
                <TextField label="Namn" value={option.name} onChange={(v) => update(index, { name: v })} />
                <NumField
                  label="Pristillägg"
                  unit="kr"
                  value={price.options[option.id] ?? 0}
                  onChange={(v) =>
                    onPriceChange({ ...price, options: { ...price.options, [option.id]: v } })
                  }
                />
              </Grid>
              <div className="mt-2">
                <Grid cols={4}>
                  <NumField
                    label="Δ längd"
                    asMeters
                    value={option.deltaLengthMm ?? 0}
                    onChange={(v) => update(index, { deltaLengthMm: v || undefined })}
                  />
                  <NumField
                    label="Δ bredd"
                    asMeters
                    value={option.deltaWidthMm ?? 0}
                    onChange={(v) => update(index, { deltaWidthMm: v || undefined })}
                  />
                  <NumField
                    label="Δ kapacitet"
                    unit="pkt/h"
                    value={option.deltaCapacity ?? 0}
                    onChange={(v) => update(index, { deltaCapacity: v || undefined })}
                  />
                  <NumField
                    label="Δ effekt"
                    unit="kW"
                    step={0.1}
                    value={option.deltaPowerKw ?? 0}
                    onChange={(v) => update(index, { deltaPowerKw: v || undefined })}
                  />
                </Grid>
              </div>
              <div className="mt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      ...machine,
                      options: machine.options.filter((_, i) => i !== index),
                    })
                  }
                >
                  Ta bort option
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
