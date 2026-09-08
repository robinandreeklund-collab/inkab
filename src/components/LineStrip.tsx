"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { meters } from "@/lib/format";
import { MachineThumb } from "./MachineThumb";

/** Linjeremsan: kedjan som en vågrät sekvens — kundens mentala modell. */
export function LineStrip() {
  const { layout, selectedId, select } = useConfigStore();
  const line = layout.placements.filter((p) => !p.aux).sort((a, b) => a.pos - b.pos);

  if (line.length === 0) return null;

  return (
    <div className="flex h-[74px] flex-none items-center gap-2 overflow-x-auto border-t border-divider bg-white px-3">
      <span
        className="kicker flex-none"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        Linjeremsan
      </span>
      {line.map((placement, index) => (
        <div key={placement.instanceId} className="flex flex-none items-center gap-2">
          <button
            onClick={() => select(placement.instanceId)}
            className={`blueprint w-[112px] flex-none p-1.5 text-left ${
              selectedId === placement.instanceId ? "border-accent bg-accent/10" : "bg-white hover:border-accent"
            }`}
          >
            <MachineThumb machine={placement.machine} className="h-8 w-full" />
            <div className="num mt-0.5 truncate text-[11px]">
              {placement.pos} {placement.machine.name.split(" ")[0]}
            </div>
            <div className="kicker truncate">{meters(placement.size.lengthMm)} m</div>
          </button>
          {index < line.length - 1 ? <span className="flex-none text-muted">→</span> : null}
        </div>
      ))}
    </div>
  );
}
