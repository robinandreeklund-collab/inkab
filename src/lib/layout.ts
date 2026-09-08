import { BUILTIN_LIBRARY, type MachineLibrary } from "./library";
import { runRules } from "./rules";
import { solveLayout } from "./solver";
import type { Configuration, LayoutResult } from "./types";

/**
 * Enda ingången till geometri + validering. Ren funktion: samma konfiguration
 * ger alltid exakt samma resultat, på klienten och på servern.
 */
export function computeLayout(
  config: Configuration,
  library: MachineLibrary = BUILTIN_LIBRARY,
): LayoutResult {
  const solved = solveLayout(config, library);
  const diagnostics = runRules(config, solved, library);
  return {
    placements: solved.placements,
    aisle: solved.aisle,
    bounds: solved.bounds,
    metrics: solved.metrics,
    diagnostics,
  };
}

export function countBySeverity(result: LayoutResult) {
  return {
    errors: result.diagnostics.filter((d) => d.severity === "error").length,
    warnings: result.diagnostics.filter((d) => d.severity === "warning").length,
    infos: result.diagnostics.filter((d) => d.severity === "info").length,
  };
}
