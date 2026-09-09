/**
 * Argumenten som de kommer in.
 *
 * Verktygsschemat säger hur ett anrop ska se ut, men bara Anthropic håller det
 * åt oss — strict-läget finns inte hos alla leverantörer. Det som kommer in
 * därifrån kan därför vara nästan rätt: nycklarna i snake_case, argumenten
 * inslagna i ett extra fält, eller hela objektet skickat som en JSON-sträng.
 *
 * Att avvisa nästan rätt är inte hjälpsamt. En modell som får "okänd maskin:
 * undefined" gör om samma anrop, för den skickade ju ett maskin-id. Här rättas
 * formen så långt den går att rätta utan att gissa på innehållet — vad som
 * faktiskt står i fälten rör vi aldrig.
 */

/** Fält som brukar användas för att slå in de riktiga argumenten. */
const WRAPPERS = ["arguments", "args", "input", "inputs", "parameters", "params"];

/** snake_case → camelCase: machine_id → machineId, from_x_m → fromXM. */
export function camelCase(key: string): string {
  if (!key.includes("_")) return key;
  const [first, ...rest] = key.split("_").filter(Boolean);
  return [first, ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1))].join("");
}

function parseIfJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function renameKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameKeys);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const name = camelCase(key);
    // Den riktiga stavningen vinner om båda finns.
    if (name in out && key !== name) continue;
    out[name] = renameKeys(parseIfJson(inner));
  }
  return out;
}

export function normaliseToolInput(raw: unknown): Record<string, unknown> {
  let value = parseIfJson(raw);

  // Ett enda fält som heter "arguments" och innehåller allt: packa upp det.
  for (let depth = 0; depth < 3; depth++) {
    if (!value || typeof value !== "object" || Array.isArray(value)) break;
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length !== 1 || !WRAPPERS.includes(keys[0])) break;
    const inner = parseIfJson((value as Record<string, unknown>)[keys[0]]);
    if (!inner || typeof inner !== "object") break;
    value = inner;
  }

  const renamed = renameKeys(value);
  return renamed && typeof renamed === "object" && !Array.isArray(renamed)
    ? (renamed as Record<string, unknown>)
    : {};
}
