"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { meters } from "@/lib/format";
import { MachineThumb } from "./MachineThumb";
import type { LineItem, Placement } from "@/lib/types";

/**
 * Linjeremsan: maskinerna i anläggningen, i den ordning de lades till.
 *
 * Remsan visade förut flödet — huvudlinje, grenar och matarlinjer på var sin
 * rad, med sina fästen utskrivna. Det förutsatte att ordningen i listan var
 * en kedja. Nu står maskinerna där kunden ställt dem, och listan är just en
 * lista: ett sätt att hitta och markera, inte en beskrivning av flödet.
 */
export function LineStrip() {
  const { config, layout, selectedId, select } = useConfigStore();
  const placements = new Map(layout.placements.map((p) => [p.instanceId, p]));
  const items = config.line.filter((i) => placements.has(i.instanceId));

  if (items.length === 0) return null;

  return (
    <div className="scroll-thin max-h-[150px] flex-none overflow-auto border-t border-divider bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="kicker w-[104px] flex-none leading-tight">Maskiner</span>
        <div className="flex flex-1 items-center gap-2 overflow-x-auto">
          {items.map((item) => (
            <Card
              key={item.instanceId}
              item={item}
              placement={placements.get(item.instanceId)!}
              selected={selectedId === item.instanceId}
              onSelect={() => select(item.instanceId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({
  item,
  placement,
  selected,
  onSelect,
}: {
  item: LineItem;
  placement: Placement;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-[118px] flex-none flex-col gap-1 border p-1 text-left ${
        selected ? "border-accent" : "border-divider hover:border-accent"
      }`}
    >
      <MachineThumb machine={placement.machine} className="h-[42px] w-full" />
      <div className="truncate text-[11px] leading-tight">
        {placement.aux ? "" : `${placement.pos} `}
        {placement.machine.name}
      </div>
      <div className="num text-[10px] text-muted">
        {meters(placement.size.lengthMm)} m{item.variantId ? ` · ${item.variantId}` : ""}
      </div>
    </button>
  );
}
