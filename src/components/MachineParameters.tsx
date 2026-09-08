"use client";

import { useConfigStore } from "@/store/useConfigStore";
import type { Machine, ParameterValue } from "@/lib/types";

/**
 * Kundens inställningar för en maskin. Fälten definieras av admin per maskin,
 * så den här komponenten renderar vad som än finns — den känner inte till
 * någon enskild parameter.
 */
export function MachineParameters({
  machine,
  instanceId,
  values,
}: {
  machine: Machine;
  instanceId: string;
  values: Record<string, ParameterValue> | undefined;
}) {
  const setParameter = useConfigStore((s) => s.setParameter);
  const parameters = machine.parameters ?? [];
  if (parameters.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="kicker mb-2">Inställningar</div>
      <div className="space-y-3">
        {parameters.map((parameter) => {
          const raw = values?.[parameter.id];

          if (parameter.type === "number") {
            const value =
              typeof raw === "number" ? raw : (parameter.defaultNumber ?? parameter.min ?? 0);
            return (
              <label key={parameter.id} className="block">
                <span className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[13px]">{parameter.label}</span>
                  <span className="num text-[11px] text-muted">
                    {value}
                    {parameter.unit ? ` ${parameter.unit}` : ""}
                  </span>
                </span>
                <input
                  type="range"
                  min={parameter.min ?? 0}
                  max={parameter.max ?? 100}
                  step={parameter.step ?? 1}
                  value={value}
                  onChange={(e) => setParameter(instanceId, parameter.id, Number(e.target.value))}
                  className="w-full accent-accent"
                />
                {parameter.help ? (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                    {parameter.help}
                  </span>
                ) : null}
              </label>
            );
          }

          if (parameter.type === "select") {
            const value = typeof raw === "string" ? raw : (parameter.defaultText ?? "");
            return (
              <label key={parameter.id} className="block">
                <span className="mb-1 block text-[13px]">{parameter.label}</span>
                <select
                  value={value}
                  onChange={(e) => setParameter(instanceId, parameter.id, e.target.value)}
                  className="w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
                >
                  {(parameter.choices ?? []).map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                {parameter.help ? (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                    {parameter.help}
                  </span>
                ) : null}
              </label>
            );
          }

          const value = typeof raw === "boolean" ? raw : (parameter.defaultBoolean ?? false);
          return (
            <label key={parameter.id} className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => setParameter(instanceId, parameter.id, e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className="text-[13px]">{parameter.label}</span>
                {parameter.help ? (
                  <span className="block text-[11px] leading-relaxed text-muted">
                    {parameter.help}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
