"use client";

import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  active = false,
  disabled = false,
  title,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  active?: boolean;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";
  const sizes = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const variants = {
    primary: "bg-ink text-paper border-ink hover:bg-steel",
    secondary: active
      ? "bg-accent text-white border-accent"
      : "bg-white text-ink border-divider hover:border-accent",
    ghost: "bg-transparent text-muted border-transparent hover:text-ink",
  }[variant];

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(base, sizes, variants, className)}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex border border-divider bg-white">
      {options.map((option, index) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            "px-2.5 py-1 text-xs transition-colors",
            index > 0 && "border-l border-divider",
            value === option.value ? "bg-accent text-white" : "text-ink hover:bg-paper",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SectionHeading({ index, title, action }: { index: number; title: string; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-4 w-4 items-center justify-center border border-divider text-[10px] text-muted num">
        {index}
      </span>
      <h2 className="kicker">{title}</h2>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="kicker mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function NumberInput({
  value,
  onCommit,
  suffix,
  min,
  max,
  step = "0.1",
}: {
  value: string;
  onCommit: (raw: string) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        defaultValue={value}
        key={value}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => onCommit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="num w-full border border-divider bg-white px-2 py-1 text-sm outline-none focus:border-accent"
      />
      {suffix ? <span className="text-xs text-muted">{suffix}</span> : null}
    </div>
  );
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "danger" | "warn" }) {
  const tones = {
    muted: "border-divider text-muted",
    accent: "border-accent text-accent",
    danger: "border-danger text-danger",
    warn: "border-warn text-warn",
  }[tone];
  return (
    <span className={cx("kicker inline-block border px-1.5 py-0.5 leading-none", tones)}>{children}</span>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1.5 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="num text-sm">{value}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border border-dashed border-divider px-3 py-4 text-xs text-muted">{children}</p>;
}
