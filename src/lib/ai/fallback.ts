import { computeLayout } from "@/lib/layout";
import { BUILTIN_LIBRARY, type MachineLibrary } from "@/lib/library";
import type { Configuration } from "@/lib/types";

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
): { text: string; suggestions: FallbackSuggestion[] } {
  const layout = computeLayout(config, library);
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
    ? `Assistenten körs utan API-nyckel, så det här är regelmotorns egna åtgärdsförslag — inte en AI-analys. Layouten har ${errors} fel och ${warnings} varningar.`
    : errors + warnings === 0
      ? "Assistenten körs utan API-nyckel. Regelmotorn hittar inga problem i den här layouten."
      : `Assistenten körs utan API-nyckel. Regelmotorn hittar ${errors} fel och ${warnings} varningar, men inget av dem har ett automatiskt åtgärdsförslag.`;

  return { text, suggestions };
}
