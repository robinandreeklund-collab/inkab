export function meters(mm: number, decimals = 1): string {
  return (mm / 1000).toFixed(decimals).replace(".", ",");
}

export function formatLength(mm: number, unit: "m" | "mm"): string {
  return unit === "m" ? `${meters(mm)} m` : `${Math.round(mm)} mm`;
}

export function parseMeters(text: string): number | null {
  const normalized = text.replace(",", ".").trim();
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000);
}

export function sek(amount: number): string {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(amount));
}

export function mkr(amount: number): string {
  return `${(amount / 1_000_000).toFixed(2).replace(".", ",")} Mkr`;
}

export function kkr(amount: number): string {
  return `${Math.round(amount / 1000)} kkr`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
