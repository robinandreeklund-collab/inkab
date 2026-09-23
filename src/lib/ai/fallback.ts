import { computeLayout } from "@/lib/layout";
import { BUILTIN_LIBRARY, type MachineLibrary } from "@/lib/library";
import type { Configuration } from "@/lib/types";
import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locale";

export type FallbackSuggestion = {
  id: string;
  name: string;
  description: string;
  config: Configuration;
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * Regelbaserade förslag när ingen ANTHROPIC_API_KEY är satt. Verktyget ska
 * fungera fullt ut utan AI — assistenten är ett lager ovanpå, inte fundamentet.
 */
export function ruleBasedSuggestions(
  config: Configuration,
  library: MachineLibrary = BUILTIN_LIBRARY,
  /** Kundens språk. Reservläget är också ett svar till kunden. */
  locale: Locale = "sv",
): { text: string; suggestions: FallbackSuggestion[] } {
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  const layout = computeLayout(config, library, t);
  const fixable = layout.diagnostics.filter((d) => d.fix);
  const suggestions: FallbackSuggestion[] = [];

  fixable.slice(0, 3).forEach((diagnostic, index) => {
    const fix = diagnostic.fix!;
    const next = clone(config);
    if (fix.kind === "flow") {
      Object.assign(next.flow, fix.patch);
    } else if (fix.kind === "addMachine") {
      next.line.push({
        instanceId: `${fix.machineId}-fix-${index}`,
        machineId: fix.machineId,
        selectedOptions: [],
      });
    } else if (fix.kind === "removeMachine") {
      next.line = next.line.filter((i) => i.instanceId !== fix.instanceId);
    }
    suggestions.push({
      id: `r${index + 1}`,
      name: fix.label,
      description: `${diagnostic.code}: ${diagnostic.detail}`,
      config: next,
    });
  });

  const errors = layout.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = layout.diagnostics.filter((d) => d.severity === "warning").length;

  const text = suggestions.length
    ? t("fallback.withFixes", { errors, warnings })
    : errors + warnings === 0
      ? t("fallback.clean")
      : t("fallback.noFixes", { errors, warnings });

  return { text, suggestions };
}
