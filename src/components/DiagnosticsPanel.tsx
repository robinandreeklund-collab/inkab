"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { useT } from "@/lib/i18n";
import { Button, Tag } from "./ui";

/**
 * Regelverkets anmärkningar, som en panel över ritytan.
 *
 * Den står till vänster om det som redan sitter i övre högra hörnet —
 * verktygsraden i planvyn, den bredare kamerapanelen i modellvyn. Förut låg
 * den rakt under dem, och kamerapanelen dolde både texten och stängknappen.
 */
export function DiagnosticsPanel() {
  const { layout, diagnosticsOpen, toggleDiagnostics, applyPatch, select, view } = useConfigStore();
  const t = useT();
  if (!diagnosticsOpen) return null;

  const list = layout.diagnostics;

  return (
    <div
      className={`blueprint absolute top-3 z-20 max-h-[70%] w-[min(400px,calc(100%-11rem))] overflow-y-auto overflow-x-hidden bg-white p-3 shadow-lg ${
        view === "model" ? "right-[156px]" : "right-14"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="kicker">{t("diag.title", { count: list.length })}</h2>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          title={t("diag.close")}
          onClick={() => toggleDiagnostics(false)}
        >
          ×
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="border border-dashed border-divider px-3 py-6 text-xs text-muted">
          {t("area.line.clean")}
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((diagnostic, index) => (
            <div key={`${diagnostic.code}-${index}`} className="border border-divider p-2">
              <div className="mb-1 flex items-center gap-2">
                <Tag
                  tone={
                    diagnostic.severity === "error"
                      ? "danger"
                      : diagnostic.severity === "warning"
                        ? "warn"
                        : "muted"
                  }
                >
                  {diagnostic.code}
                </Tag>
                <span className="text-[13px]">{diagnostic.title}</span>
              </div>
              <p className="mb-2 text-xs leading-relaxed text-muted">{diagnostic.detail}</p>
              <div className="flex flex-wrap gap-2">
                {diagnostic.fix ? (
                  <Button size="sm" onClick={() => applyPatch(diagnostic.fix!)}>
                    {diagnostic.fix.label}
                  </Button>
                ) : null}
                {diagnostic.instanceIds[0] ? (
                  <Button size="sm" variant="ghost" onClick={() => select(diagnostic.instanceIds[0])}>
                    {t("diag.show")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
