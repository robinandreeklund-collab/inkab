import type { Locale } from "./i18n/locale";
import type { Machine } from "./types";

/**
 * Maskinens namn och beskrivning på kundens språk.
 *
 * Katalogen skrivs på svenska, och översättningarna läggs in av admin per
 * maskin. Saknas en översättning — hela språket eller bara ett av fälten —
 * visas svenskan: hellre ett svenskt maskinnamn i en tysk offert än en tom
 * rad i maskinlistan.
 */
export function localizeMachine(machine: Machine, locale: Locale): Machine {
  if (locale === "sv") return machine;
  const translation = machine.translations?.[locale];
  const name = translation?.name?.trim();
  const summary = translation?.summary?.trim();
  if (!name && !summary) return machine;
  return { ...machine, name: name || machine.name, summary: summary || machine.summary };
}

export function localizeMachines(machines: Machine[], locale: Locale): Machine[] {
  return machines.map((m) => localizeMachine(m, locale));
}

/** Vilka språk en maskin saknar översättning till, för admin. */
export function missingTranslations(machine: Machine): ("en" | "de")[] {
  return (["en", "de"] as const).filter((locale) => !machine.translations?.[locale]?.name?.trim());
}
