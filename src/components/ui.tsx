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
  // Värdena formateras med svenskt decimalkomma i gränssnittet, men
  // <input type="number"> accepterar bara punkt och renderar tomt annars.
  const normalized = value.replace(",", ".");

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        defaultValue={normalized}
        key={normalized}
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

/**
 * Rotationsikonens geometri, i ett rutnät på 24 × 24.
 *
 * Bågen och spetsen ligger här i stället för hos den som ritar dem, så att
 * handtaget i ritningen och knapparna i inspektorn blir exakt samma tecken.
 * Förut var det en hemmagjord båge med en fylld triangel på ena stället och
 * unicodetecknen ↺ ↻ på det andra — två olika saker för samma handling, och
 * ingen av dem i husets tunna linjestil.
 *
 * Bågen går tre kvarts varv och slutar överst, där spetsen pekar medurs.
 * Moturs är samma tecken speglat, så de alltid väger lika.
 */
/*
 * Bågen: tre kvarts varv medurs, från höger runt till toppen, kring (12, 12).
 *
 * Flaggorna är inte utbytbara. Ett bågkommando har två tänkbara medelpunkter,
 * och large-arc och sweep väljer vilken. Med fel par låg medelpunkten i
 * (5, 5) i stället, så hela tecknet drogs ett halvt varv upp till vänster och
 * hängde utanför sin egen ring.
 */
export const ROTATE_ARC = "M19 12A7 7 0 1 1 12 5";
export const ROTATE_TIP = "M9.4 2.8 12 5 9.4 7.2";

export function RotateIcon({
  anticlockwise = false,
  size = 16,
}: {
  anticlockwise?: boolean;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <g
        transform={anticlockwise ? "translate(24 0) scale(-1 1)" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ROTATE_ARC} />
        <path d={ROTATE_TIP} />
      </g>
    </svg>
  );
}

/** Spegelvändning: två halvor kring en tänkt axel. */
export function MirrorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3v18" strokeDasharray="2 2.5" />
      <path d="M9 7 4 12l5 5z" strokeLinejoin="round" />
      <path d="M15 7l5 5-5 5z" strokeLinejoin="round" />
    </svg>
  );
}
