"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { Button, Tag } from "./ui";

export function DiagnosticsPanel() {
  const { layout, diagnosticsOpen, toggleDiagnostics, applyPatch, select } = useConfigStore();
  if (!diagnosticsOpen) return null;

  const list = layout.diagnostics;

  return (
    <div className="blueprint absolute right-3 top-3 max-h-[70%] w-[400px] overflow-y-auto bg-white p-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="kicker">Diagnostik · {list.length} poster</h2>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => toggleDiagnostics(false)}>
          ×
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="border border-dashed border-divider px-3 py-6 text-xs text-muted">
          Regelmotorn hittar inga problem i den här layouten.
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
                    Visa i vyn
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
