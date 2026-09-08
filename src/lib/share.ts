import { configurationSchema } from "./schema";
import type { Configuration } from "./types";

/**
 * Delningslänk.
 *
 * Hela konfigurationen ligger i länken — inget sparas på servern, och en länk
 * fungerar därför utan konto och utan databas. Priset är längden, så
 * innehållet komprimeras med gzip via webbläsarens egen CompressionStream.
 * Saknas den (äldre Safari) faller den tillbaka på okomprimerad base64, och
 * länken blir längre men fungerar.
 *
 * Prefixet talar om vilken variant det är, så en gammal länk fortsätter gälla:
 *   z. = gzip + base64url
 *   (utan prefix) = ren base64url, formatet före komprimeringen
 */

const GZIP_PREFIX = "z.";

/** Över det här slutar länkar fungera i vissa e-postklienter och chattar. */
export const LONG_URL_CHARS = 2000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 =
    typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === "function") {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function hasCompression(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return collect(stream as ReadableStream<Uint8Array>);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return collect(stream as ReadableStream<Uint8Array>);
}

export async function encodeConfig(config: Configuration): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(config));
  if (!hasCompression()) return toBase64Url(json);
  try {
    return GZIP_PREFIX + toBase64Url(await gzip(json));
  } catch {
    // Komprimeringen är en optimering, aldrig ett krav.
    return toBase64Url(json);
  }
}

export type DecodeResult =
  | { ok: true; config: Configuration }
  | { ok: false; reason: "unreadable" | "invalid" };

/**
 * Läser en delad konfiguration.
 *
 * Returnerar ett resultat, aldrig ett undantag och aldrig null: en trasig
 * länk ska sägas rakt ut för den som klickade på den. Skillnaden mellan
 * `unreadable` och `invalid` spelar roll — den första betyder avhuggen eller
 * felkopierad länk, den andra att innehållet inte längre stämmer med
 * konfigurationsformatet.
 */
export async function decodeConfig(encoded: string): Promise<DecodeResult> {
  let json: string;
  try {
    if (encoded.startsWith(GZIP_PREFIX)) {
      const raw = fromBase64Url(encoded.slice(GZIP_PREFIX.length));
      json = new TextDecoder().decode(await gunzip(raw));
    } else {
      json = new TextDecoder().decode(fromBase64Url(encoded));
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  try {
    const parsed = configurationSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return { ok: false, reason: "invalid" };
    return { ok: true, config: parsed.data as Configuration };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Bygger hela adressen, med samma sida och utan gamla parametrar. */
export async function shareUrl(config: Configuration, origin: string, pathname: string) {
  const encoded = await encodeConfig(config);
  const url = `${origin}${pathname}?c=${encoded}`;
  return { url, long: url.length > LONG_URL_CHARS };
}
