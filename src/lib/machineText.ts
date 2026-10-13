import type { Locale } from "./i18n/locale";
import type { Machine, MachineParameter } from "./types";

/**
 * Maskinens texter på kundens språk.
 *
 * Katalogen skrivs på svenska, och översättningarna läggs in av admin per
 * maskin: namn, kort beskrivning och det kunden ställer in — tillval,
 * utföranden och parametrar med sina val. Saknas en översättning — hela
 * språket eller bara en av texterna — visas svenskan: hellre ett svenskt ord
 * i en tysk offert än en tom rad.
 *
 * Bara texterna översätts. Id:n, värden och priser är desamma på alla språk,
 * så en sparad konfiguration betyder samma sak vilket språk den än visas på.
 */

/** Nycklarna i MachineTranslation.texts. */
export const textKey = {
  option: (id: string) => `option.${id}`,
  variant: (id: string) => `variant.${id}`,
  paramLabel: (id: string) => `param.${id}.label`,
  paramHelp: (id: string) => `param.${id}.help`,
  paramUnit: (id: string) => `param.${id}.unit`,
  paramChoice: (id: string, value: string) => `param.${id}.choice.${value}`,
};

export function localizeMachine(machine: Machine, locale: Locale): Machine {
  if (locale === "sv") return machine;
  const translation = machine.translations?.[locale];
  if (!translation) return machine;
  const name = translation.name?.trim();
  const summary = translation.summary?.trim();
  const texts = translation.texts ?? {};
  const hasTexts = Object.values(texts).some((v) => v.trim());
  if (!name && !summary && !hasTexts) return machine;

  const text = (key: string, fallback: string) => texts[key]?.trim() || fallback;
  const localized: Machine = { ...machine, name: name || machine.name, summary: summary || machine.summary };
  if (!hasTexts) return localized;

  localized.options = machine.options.map((o) => ({ ...o, name: text(textKey.option(o.id), o.name) }));
  if (machine.variants) {
    localized.variants = machine.variants.map((v) => ({ ...v, name: text(textKey.variant(v.id), v.name) }));
  }
  if (machine.parameters) {
    localized.parameters = machine.parameters.map((p) => localizeParameter(p, text));
  }
  return localized;
}

function localizeParameter(
  parameter: MachineParameter,
  text: (key: string, fallback: string) => string,
): MachineParameter {
  const next: MachineParameter = { ...parameter, label: text(textKey.paramLabel(parameter.id), parameter.label) };
  if (parameter.help) next.help = text(textKey.paramHelp(parameter.id), parameter.help);
  if (parameter.unit) next.unit = text(textKey.paramUnit(parameter.id), parameter.unit);
  if (parameter.choices) {
    next.choices = parameter.choices.map((c) => ({
      ...c,
      label: text(textKey.paramChoice(parameter.id, c.value), c.label),
    }));
  }
  return next;
}

export function localizeMachines(machines: Machine[], locale: Locale): Machine[] {
  return machines.map((m) => localizeMachine(m, locale));
}

/** Alla texter i en maskins inställningar som går att översätta, med svenskan. */
export function translatableTexts(machine: Machine): { key: string; group: string; sv: string }[] {
  const out: { key: string; group: string; sv: string }[] = [];
  for (const v of machine.variants ?? []) out.push({ key: textKey.variant(v.id), group: "Utförande", sv: v.name });
  for (const o of machine.options) out.push({ key: textKey.option(o.id), group: "Tillval", sv: o.name });
  for (const p of machine.parameters ?? []) {
    out.push({ key: textKey.paramLabel(p.id), group: "Parameter", sv: p.label });
    if (p.help) out.push({ key: textKey.paramHelp(p.id), group: `${p.label} · hjälptext`, sv: p.help });
    if (p.unit) out.push({ key: textKey.paramUnit(p.id), group: `${p.label} · enhet`, sv: p.unit });
    for (const c of p.choices ?? []) {
      out.push({ key: textKey.paramChoice(p.id, c.value), group: `${p.label} · val`, sv: c.label });
    }
  }
  return out;
}

/**
 * Vilka språk en maskin saknar översättning till, för admin. Ett språk är
 * komplett när namnet och alla inställningarnas texter finns. Enheter räknas
 * inte: "mm" och "kW" är desamma på alla tre språken, och ett "saknas" som
 * aldrig går att få bort lär admin att strunta i markeringen.
 */
export function missingTranslations(machine: Machine): ("en" | "de")[] {
  const keys = translatableTexts(machine)
    .map((t) => t.key)
    .filter((k) => !/^param\..+\.unit$/.test(k));
  return (["en", "de"] as const).filter((locale) => {
    const tr = machine.translations?.[locale];
    if (!tr?.name?.trim()) return true;
    return keys.some((k) => !tr.texts?.[k]?.trim());
  });
}
