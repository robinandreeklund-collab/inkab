"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { meters } from "@/lib/format";
import { segments } from "@/lib/branches";
import { MachineThumb } from "./MachineThumb";
import type { LineItem, Placement } from "@/lib/types";

/**
 * Linjeremsan: flödet som vågräta rader — kundens mentala modell.
 *
 * Huvudlinjen överst, varje gren på egen rad under med sitt fäste utskrivet.
 * En gren är en egen väg genom anläggningen, inte en fotnot till huvudlinjen,
 * och att trycka in den i samma rad hade gjort ordningen till en gissning.
 */
export function LineStrip() {
  const { config, layout, selectedId, select } = useConfigStore();
  const placements = new Map(layout.placements.map((p) => [p.instanceId, p]));
  const parts = segments(config.line).filter((s) =>
    s.items.some((i) => placements.has(i.instanceId)),
  );

  if (parts.length === 0) return null;

  const nameOf = (instanceId: string) =>
    placements.get(instanceId)?.machine.name.split(" ")[0] ?? "maskin";
  const portNameOf = (instanceId: string, portId: string) => {
    const machine = placements.get(instanceId)?.machine;
    const port = machine?.ports.find((p) => p.id === portId);
    return port?.name ?? portId;
  };

  return (
    <div className="scroll-thin max-h-[150px] flex-none overflow-auto border-t border-divider bg-white">
      {parts.map((segment, index) => (
        <div key={index} className="flex items-center gap-2 border-b border-divider/60 px-3 py-1.5 last:border-0">
          <span className="kicker w-[104px] flex-none leading-tight">
            {segment.branch ? (
              <>
                Gren från {nameOf(segment.branch.fromInstanceId)}
                <span className="block text-muted">
                  {portNameOf(segment.branch.fromInstanceId, segment.branch.outPortId)}
                </span>
              </>
            ) : (
              "Linjeremsan"
            )}
          </span>
          <div className="flex flex-1 items-center gap-2 overflow-x-auto">
            {segment.items.map((item, i) => {
              const placement = placements.get(item.instanceId);
              if (!placement) return null;
              return (
                <Card
                  key={item.instanceId}
                  item={item}
                  placement={placement}
                  selected={selectedId === item.instanceId}
                  last={i === segment.items.length - 1}
                  onSelect={() => select(item.instanceId)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({
  item,
  placement,
  selected,
  last,
  onSelect,
}: {
  item: LineItem;
  placement: Placement;
  selected: boolean;
  last: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="flex flex-none items-center gap-2">
      <button
        onClick={onSelect}
        className={`blueprint w-[112px] flex-none p-1.5 text-left ${
          selected ? "border-accent bg-accent/10" : "bg-white hover:border-accent"
        }`}
      >
        <MachineThumb machine={placement.machine} className="h-8 w-full" />
        <div className="num mt-0.5 truncate text-[11px]">
          {placement.pos} {placement.machine.name.split(" ")[0]}
        </div>
        <div className="kicker truncate">
          {meters(placement.size.lengthMm)} m
          {item.variantId ? ` · ${item.variantId}` : ""}
        </div>
      </button>
      {last ? null : <span className="flex-none text-muted">→</span>}
    </div>
  );
}
