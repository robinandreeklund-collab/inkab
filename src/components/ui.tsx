"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
 * Förklaring som dyker upp när man håller musen över något.
 *
 * Ritas i en portal med fast position: sidopanelen och ritytan klipper allt
 * som sticker utanför dem, och en förklaring som klipps är ingen förklaring.
 * Visas också vid tangentbordsfokus.
 */
export function Tip({
  title,
  body,
  shortcut,
  side = "bottom",
  children,
  className,
  block = false,
}: {
  title?: ReactNode;
  body?: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
  className?: string;
  /** Fyll bredden i stället för att bara omsluta innehållet. */
  block?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (ref.current) setRect(ref.current.getBoundingClientRect());
    }, 250);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setRect(null);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide}
      className={cx(block ? "flex w-full" : "inline-flex", className)}
    >
      {children}
      {rect && typeof document !== "undefined"
        ? createPortal(<TipCard rect={rect} side={side} title={title} body={body} shortcut={shortcut} />, document.body)
        : null}
    </span>
  );
}

const TIP_WIDTH = 248;
const GAP = 8;

export function TipCard({
  rect,
  side,
  title,
  body,
  shortcut,
}: {
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  side: "top" | "bottom" | "left" | "right";
  title?: ReactNode;
  body?: ReactNode;
  shortcut?: string;
}) {
  const style: CSSProperties = { position: "fixed", width: TIP_WIDTH, zIndex: 100 };
  const clampX = (x: number) => Math.max(8, Math.min(window.innerWidth - TIP_WIDTH - 8, x));
  if (side === "left") {
    style.left = Math.max(8, rect.left - TIP_WIDTH - GAP);
    style.top = rect.top;
  } else if (side === "right") {
    style.left = Math.min(window.innerWidth - TIP_WIDTH - 8, rect.right + GAP);
    style.top = rect.top;
  } else if (side === "top") {
    style.left = clampX(rect.left + rect.width / 2 - TIP_WIDTH / 2);
    style.bottom = window.innerHeight - rect.top + GAP;
  } else {
    style.left = clampX(rect.left + rect.width / 2 - TIP_WIDTH / 2);
    style.top = rect.bottom + GAP;
  }

  return (
    <div role="tooltip" style={style} className="pointer-events-none border border-steel bg-steel px-2.5 py-2 text-left text-white shadow-lg">
      {title ? (
        <div className="flex items-baseline justify-between gap-2 text-[13px] leading-tight">
          <span>{title}</span>
          {shortcut ? (
            <kbd className="num border border-white/40 px-1 text-[10px] leading-4 text-white/80">{shortcut}</kbd>
          ) : null}
        </div>
      ) : null}
      {body ? <div className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-white/80">{body}</div> : null}
    </div>
  );
}
