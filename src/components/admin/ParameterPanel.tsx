"use client";

import { Button, Tag } from "../ui";
import { CheckField, Grid, NumField, Panel, SelectField, TextField } from "./fields";
import type { Machine, MachineParameter } from "@/lib/types";

/**
 * Admin definierar vilka inställningar kunden ser när maskinen är markerad.
 * En talparameter kan dessutom styra kapacitet eller mått direkt i motorn.
 */
export function ParameterPanel({
  machine,
  onChange,
}: {
  machine: Machine;
  onChange: (parameters: MachineParameter[]) => void;
}) {
  const parameters = machine.parameters ?? [];

  const update = (index: number, patch: Partial<MachineParameter>) =>
    onChange(parameters.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const add = () =>
    onChange([
      ...parameters,
      {
        id: `param-${parameters.length + 1}`,
        label: "Ny inställning",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultNumber: 0,
      },
    ]);

  return (
    <Panel
      title="Kundens inställningar"
      description="Visas i inspektorn när kunden markerar maskinen. Kan bära pris och styra motorn."
      action={
        <Button size="sm" onClick={add}>
          + Inställning
        </Button>
      }
    >
      {parameters.length === 0 ? (
        <p className="border border-dashed border-divider px-3 py-4 text-xs text-muted">
          Inga inställningar. Lägg till t.ex. önskad virkestakt eller ströets dimension.
        </p>
      ) : (
        <div className="space-y-3">
          {parameters.map((parameter, index) => (
            <div key={index} className="border border-divider p-2">
              <div className="mb-2 flex items-center gap-2">
                <Tag tone="accent">{parameter.type}</Tag>
                {parameter.affects ? <Tag tone="warn">styr {parameter.affects}</Tag> : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => onChange(parameters.filter((_, i) => i !== index))}
                >
                  Ta bort
                </Button>
              </div>

              <Grid cols={3}>
                <TextField label="Id" mono value={parameter.id} onChange={(v) => update(index, { id: v })} />
                <TextField
                  label="Etikett"
                  value={parameter.label}
                  onChange={(v) => update(index, { label: v })}
                />
                <SelectField<MachineParameter["type"]>
                  label="Typ"
                  value={parameter.type}
                  options={[
                    { value: "number", label: "Tal (reglage)" },
                    { value: "select", label: "Lista" },
                    { value: "boolean", label: "Ja/nej" },
                  ]}
                  onChange={(v) => update(index, { type: v, affects: undefined })}
                />
              </Grid>

              <div className="mt-2">
                <TextField
                  label="Hjälptext"
                  value={parameter.help ?? ""}
                  onChange={(v) => update(index, { help: v || undefined })}
                />
              </div>

              {parameter.type === "number" ? (
                <>
                  <div className="mt-2">
                    <Grid cols={4}>
                      <NumField
                        label="Min"
                        value={parameter.min ?? 0}
                        onChange={(v) => update(index, { min: v })}
                      />
                      <NumField
                        label="Max"
                        value={parameter.max ?? 100}
                        onChange={(v) => update(index, { max: v })}
                      />
                      <NumField
                        label="Steg"
                        value={parameter.step ?? 1}
                        onChange={(v) => update(index, { step: Math.max(0.001, v) })}
                      />
                      <NumField
                        label="Standardvärde"
                        value={parameter.defaultNumber ?? 0}
                        onChange={(v) => update(index, { defaultNumber: v })}
                      />
                    </Grid>
                  </div>
                  <div className="mt-2">
                    <Grid cols={3}>
                      <TextField
                        label="Enhet"
                        value={parameter.unit ?? ""}
                        onChange={(v) => update(index, { unit: v || undefined })}
                      />
                      <NumField
                        label="Pris per enhet"
                        unit="kr"
                        value={parameter.pricePerUnit ?? 0}
                        onChange={(v) => update(index, { pricePerUnit: v || undefined })}
                      />
                      <SelectField
                        label="Styr i motorn"
                        hint="valfritt"
                        value={parameter.affects ?? ""}
                        options={[
                          { value: "", label: "Inget — bara dokumentation" },
                          { value: "capacity", label: "Kapacitet (paket/h)" },
                          { value: "lengthMm", label: "Maskinens längd (mm)" },
                          { value: "widthMm", label: "Maskinens bredd (mm)" },
                          { value: "heightMm", label: "Maskinens höjd (mm)" },
                        ]}
                        onChange={(v) =>
                          update(index, {
                            affects: (v || undefined) as MachineParameter["affects"],
                          })
                        }
                      />
                    </Grid>
                  </div>
                  {parameter.affects && parameter.affects !== "capacity" ? (
                    <p className="mt-1 text-[11px] text-muted">
                      Värdet anges i millimeter och ersätter maskinens mått i layouten.
                    </p>
                  ) : null}
                </>
              ) : null}

              {parameter.type === "select" ? (
                <div className="mt-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="kicker">Val</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        update(index, {
                          choices: [
                            ...(parameter.choices ?? []),
                            { value: `val-${(parameter.choices?.length ?? 0) + 1}`, label: "Nytt val" },
                          ],
                        })
                      }
                    >
                      + Val
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {(parameter.choices ?? []).map((choice, ci) => (
                      <Grid key={ci} cols={4}>
                        <TextField
                          label="Värde"
                          mono
                          value={choice.value}
                          onChange={(v) =>
                            update(index, {
                              choices: parameter.choices!.map((c, i) =>
                                i === ci ? { ...c, value: v } : c,
                              ),
                            })
                          }
                        />
                        <TextField
                          label="Text"
                          value={choice.label}
                          onChange={(v) =>
                            update(index, {
                              choices: parameter.choices!.map((c, i) =>
                                i === ci ? { ...c, label: v } : c,
                              ),
                            })
                          }
                        />
                        <NumField
                          label="Pristillägg"
                          unit="kr"
                          value={choice.priceDelta ?? 0}
                          onChange={(v) =>
                            update(index, {
                              choices: parameter.choices!.map((c, i) =>
                                i === ci ? { ...c, priceDelta: v || undefined } : c,
                              ),
                            })
                          }
                        />
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              update(index, {
                                choices: parameter.choices!.filter((_, i) => i !== ci),
                              })
                            }
                          >
                            Ta bort
                          </Button>
                        </div>
                      </Grid>
                    ))}
                  </div>
                  <div className="mt-2 max-w-xs">
                    <TextField
                      label="Standardval"
                      mono
                      value={parameter.defaultText ?? ""}
                      onChange={(v) => update(index, { defaultText: v || undefined })}
                    />
                  </div>
                </div>
              ) : null}

              {parameter.type === "boolean" ? (
                <div className="mt-2">
                  <Grid cols={2}>
                    <NumField
                      label="Pristillägg när påslagen"
                      unit="kr"
                      value={parameter.priceWhenTrue ?? 0}
                      onChange={(v) => update(index, { priceWhenTrue: v || undefined })}
                    />
                    <div className="flex items-end">
                      <CheckField
                        label="Påslagen som standard"
                        checked={!!parameter.defaultBoolean}
                        onChange={(v) => update(index, { defaultBoolean: v || undefined })}
                      />
                    </div>
                  </Grid>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
