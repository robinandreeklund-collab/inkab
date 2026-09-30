import { MESSAGES } from "./messages";
import type { Locale } from "./locale";

/**
 * Slår upp en text och fyller dess platshållare.
 *
 * Ligger för sig utan "use client" och utan att röra lagret, så att
 * regelverket — som körs både i webbläsaren och på servern — kan använda
 * den. Kroken useT() i index.ts är samma funktion med kundens språk ifyllt.
 *
 * Saknas nyckeln i det valda språket används svenskan, och saknas den där
 * också visas nyckeln själv. Bägge är fel som ska synas: en tom sträng hade
 * bara lämnat ett hål i gränssnittet som ingen upptäcker.
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = MESSAGES[locale]?.[key] ?? MESSAGES.sv[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (hela, namn: string) =>
    namn in vars ? String(vars[namn]) : hela,
  );
}
