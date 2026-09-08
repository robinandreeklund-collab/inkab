"use client";

import type { ReactNode } from "react";
import { cx } from "../ui";

export function Panel({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="mb-4 border border-divider bg-white">
      <header className="flex items-center gap-2 border-b border-divider px-3 py-2">
        <div>
          <h3 className="kicker">{title}</h3>
          {description ? <p className="text-[11px] text-muted">{description}</p> : null}
        </div>
        {action ? <div className="ml-auto">{action}</div> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Grid({ cols = 3, children }: { cols?: 2 | 3 | 4; children: ReactNode }) {
  const map = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" } as const;
  return <div className={cx("grid gap-3", map[cols])}>{children}</div>;
}

function Label({ label, hint, error }: { label: string; hint?: string; error?: string }) {
  return (
    <span className="mb-1 block">
      <span className="kicker">{label}</span>
      {hint ? <span className="ml-1 text-[10px] text-muted">{hint}</span> : null}
      {error ? <span className="ml-1 text-[10px] text-danger">{error}</span> : null}
    </span>
  );
}

const inputClass =
  "w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent disabled:bg-paper disabled:text-muted";

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
  disabled,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <Label label={label} hint={hint} error={error} />
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass, mono && "num", error && "border-danger")}
      />
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <Label label={label} />
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass, "resize-y leading-relaxed")}
      />
    </label>
  );
}

/**
 * Talfält. Millimetervärden matas in i meter eftersom det är så konstruktörer
 * pratar, men lagras alltid som heltal mm.
 */
export function NumField({
  label,
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  error,
  hint,
  asMeters = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  error?: string;
  hint?: string;
  asMeters?: boolean;
}) {
  const shown = asMeters ? value / 1000 : value;
  return (
    <label className="block">
      <Label label={label} hint={hint ?? (asMeters ? "m" : unit)} error={error} />
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={Number.isFinite(shown) ? shown : 0}
          step={asMeters ? 0.001 : step}
          min={min}
          max={max}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (!Number.isFinite(raw)) return;
            onChange(asMeters ? Math.round(raw * 1000) : raw);
          }}
          className={cx(inputClass, "num", error && "border-danger")}
        />
        {unit && !asMeters ? <span className="text-[11px] text-muted">{unit}</span> : null}
      </div>
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <Label label={label} hint={hint} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={inputClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-accent"
      />
      <span>
        <span className="text-[13px]">{label}</span>
        {hint ? <span className="block text-[11px] text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function MultiSelect({
  label,
  values,
  options,
  onChange,
  hint,
}: {
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
  hint?: string;
}) {
  return (
    <div>
      <Label label={label} hint={hint} />
      <div className="max-h-32 overflow-y-auto border border-divider p-1">
        {options.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-muted">Inga andra maskiner i biblioteket.</p>
        ) : (
          options.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-2 px-1 py-0.5">
              <input
                type="checkbox"
                checked={values.includes(option.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...values, option.value]
                      : values.filter((v) => v !== option.value),
                  )
                }
                className="accent-accent"
              />
              <span className="text-[12px]">{option.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export function IssueList({ issues }: { issues: { path: string; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mb-3 space-y-1 border border-danger bg-white p-2">
      {issues.map((issue, index) => (
        <li key={index} className="text-xs text-danger">
          <span className="num mr-2 opacity-70">{issue.path || "—"}</span>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
