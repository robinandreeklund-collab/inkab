"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { meters } from "@/lib/format";
import { segments } from "@/lib/branches";
import {
  edgeItemsWithFallback,
  edgeLabel,
  isSharedNode,
  orderedEdges,
} from "@/lib/flowGraph";
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
  const { config, layout, selectedId, select, selectedEdgeId, selectEdge } = useConfigStore();
  const placements = new Map(layout.placements.map((p) => [p.instanceId, p]));
  const graph = config.flowGraph;

  /*
   * Med ritat flöde är raderna grenarna kunden själv dragit — samma ordning
   * som solvern placerar dem i, så att remsan och hallen berättar samma sak.
   * Att markera en rad är att peka ut var nästa maskin ur katalogen hamnar.
   */
  if (graph && graph.edges.length > 0) {
    const runs = new Map(layout.edgeRuns.map((r) => [r.edgeId, r]));

    return (
      <div className="scroll-thin max-h-[190px] flex-none overflow-auto border-t border-divider bg-white">
        {orderedEdges(graph).map((edge) => {
          const items = edgeItemsWithFallback(config.line, graph, edge.id);
          const run = runs.get(edge.id);
          const active = edge.id === selectedEdgeId;

          return (
            <div
              key={edge.id}
              className={`flex items-center gap-2 border-b border-divider/60 px-3 py-1.5 last:border-0 ${
                active ? "bg-accent/5" : ""
              }`}
            >
              <button
                data-edge={edge.id}
                onClick={() => selectEdge(active ? null : edge.id)}
                className={`w-[124px] flex-none border px-1.5 py-1 text-left leading-tight ${
                  active ? "border-accent text-accent" : "border-transparent hover:border-divider"
                }`}
                title="Markera grenen — nästa maskin ur katalogen hamnar här"
              >
                <span className="kicker block">{edgeLabel(graph, edge)}</span>
                <span className="kicker block text-muted">
                  {items.length} maskin{items.length === 1 ? "" : "er"}
                </span>
              </button>
              <div className="flex flex-1 items-center gap-2 overflow-x-auto">
                {items.length === 0 ? (
                  <span className="text-[11px] text-muted">
                    Tom gren. Markera den och välj en maskin ur katalogen.
                  </span>
                ) : (
                  items.map((item, i) => {
                    const placement = placements.get(item.instanceId);
                    if (!placement) return null;
                    return (
                      <Card
                        key={item.instanceId}
                        item={item}
                        placement={placement}
                        selected={selectedId === item.instanceId}
                        last={i === items.length - 1}
                        onSelect={() => select(item.instanceId)}
                      />
                    );
                  })
                )}
              </div>
              {run &&
              run.gapMm !== null &&
              run.gapMm > 500 &&
              edge.toNodeId &&
              isSharedNode(graph, edge.toNodeId) ? (
                <span className="kicker flex-none text-warn" title="Avstånd till den ritade noden">
                  {meters(run.gapMm)} m kvar
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

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
