import { configurationSchema } from "./schema";
import type { Configuration } from "./types";

/** URL-säker base64 utan beroenden, fungerar i både browser och Node. */
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

export function encodeConfig(config: Configuration): string {
  return toBase64Url(JSON.stringify(config));
}

/** Returnerar null vid trasig eller manipulerad länk i stället för att kasta. */
export function decodeConfig(encoded: string): Configuration | null {
  try {
    const parsed = configurationSchema.safeParse(JSON.parse(fromBase64Url(encoded)));
    return parsed.success ? (parsed.data as Configuration) : null;
  } catch {
    return null;
  }
}
