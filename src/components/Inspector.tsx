"use client";

import { useEffect, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { meters } from "@/lib/format";
import { Button, Row, Tag } from "./ui";
import type { PriceResult } from "@/lib/server/pricing";

export function Inspector({ price, role }: { price: PriceResult | null; role: "guest" | "sales" }) {
  const {
    config,
    layout,
    selectedId,
    toggleInspector,
    toggleOption,
    removeItem,
    removeDrawn,
    resetOffset,
    nudge,
  } = useConfigStore();

  const placement = layout.placements.find((p) => p.instanceId === selectedId) ?? null;
  const drawn = config.drawn.find((d) => d.id === selectedId) ?? null;
  const item = config.line.find((i) => i.instanceId === selectedId) ?? null;
  const priceLine = price?.lines.find((l) => l.instanceId === selectedId);

  return (
    <aside className="scroll-thin flex h-full w-[300px] flex-none flex-col overflow-y-auto border-l border-divider bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="kicker">Inspektor</h2>
        <Button variant="ghost" size="sm" onClick={toggleInspector}>
          Fäll in ›
        </Button>
      </div>

      {!placement && !drawn ? (
        <p className="border border-dashed border-divider px-3 py-6 text-xs text-muted">
          Inget markerat. Klicka på ett objekt i vyn eller i linjelistan.
        </p>
      ) : null}

      {drawn ? (
        <div>
          <div className="kicker">{drawn.kind === "wall" ? "Ritat objekt · vägg" : "Ritat objekt · no-go"}</div>
          <h3 className="mb-3 text-lg">{drawn.name}</h3>
          <Row label="Mått L×B" value={`${meters(drawn.l)} × ${meters(drawn.w)} m`} />
          <Row label="Position X, Y" value={`${meters(drawn.x)} , ${meters(drawn.y)} m`} />
          <Button className="mt-3 w-full" variant="ghost" onClick={() => removeDrawn(drawn.id)}>
            Ta bort
          </Button>
        </div>
      ) : null}

      {placement ? (
        <div>
          <div className="kicker">
            {placement.machine.sku} · {placement.aux ? "Hjälpobjekt" : `Position ${placement.pos}`}
          </div>
          <h3 className="mb-1 text-lg leading-tight">{placement.machine.name}</h3>
          <p className="mb-3 text-xs leading-relaxed text-muted">{placement.machine.summary}</p>

          <Row
            label="Mått L×B×H"
            value={`${meters(placement.size.lengthMm)} × ${meters(placement.size.widthMm)} × ${meters(placement.size.heightMm)} m`}
          />
          <Row label="Position X, Y" value={`${meters(placement.bbox.x)} , ${meters(placement.bbox.y)} m`} />
          <Row label="Rotation" value={`${placement.rotation}°${placement.mirrored ? " · speglad" : ""}`} />
          <Row label="Kapacitet" value={placement.capacity > 0 ? `${placement.capacity} pkt/h` : "—"} />
          <Row label="Effekt" value={`${placement.powerKw} kW`} />
          <Row
            label="Tryckluft"
            value={
              placement.machine.utilities.airNlPerMin > 0
                ? `${placement.machine.utilities.airNlPerMin} Nl/min`
                : "—"
            }
          />
          <Row
            label="Grop"
            value={
              placement.machine.foundation.pitDepthMm > 0
                ? `${placement.machine.foundation.pitDepthMm} mm`
                : "Ingen"
            }
          />
          <Row label="Leveranstid" value={`${placement.machine.leadTimeWeeks} v`} />

          {item && placement.machine.options.length > 0 ? (
            <div className="mt-4">
              <div className="kicker mb-2">Optioner</div>
              <div className="space-y-1">
                {placement.machine.options.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-2 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      checked={item.selectedOptions.includes(option.id)}
                      onChange={() => toggleOption(item.instanceId, option.id)}
                      className="accent-accent"
                    />
                    <span className="flex-1">{option.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="blueprint mt-4 p-3">
            <div className="kicker">Pris</div>
            {role === "sales" && priceLine?.rowTotal != null ? (
              <>
                <div className="num text-xl">{formatSek(priceLine.rowTotal)}</div>
                <div className="text-[11px] text-muted">
                  {price?.priceBookName}
                  {priceLine.optionsPrice ? ` · optioner ${formatSek(priceLine.optionsPrice)}` : ""}
                </div>
              </>
            ) : (
              <>
                <div className="text-base">Se pris →</div>
                <div className="text-[11px] text-muted">Logga in för prisuppgift</div>
              </>
            )}
          </div>

          {item?.manualOffset ? (
            <div className="mt-3 flex items-center gap-2">
              <Tag tone="warn">Manuellt flyttad</Tag>
              <Button size="sm" variant="ghost" onClick={() => resetOffset(item.instanceId)}>
                Återställ
              </Button>
            </div>
          ) : null}

          {item ? (
            <div className="mt-4 space-y-2">
              <div className="kicker">Finjustera</div>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    ["←", { x: -250, y: 0 }],
                    ["→", { x: 250, y: 0 }],
                    ["↑", { x: 0, y: -250 }],
                    ["↓", { x: 0, y: 250 }],
                  ] as const
                ).map(([label, delta]) => (
                  <Button key={label} size="sm" onClick={() => nudge(item.instanceId, delta)}>
                    {label}
                  </Button>
                ))}
              </div>
              <StepButton file={placement.machine.stepFile} name={placement.machine.name} role={role} />
              <Button className="w-full" variant="ghost" onClick={() => removeItem(item.instanceId)}>
                Ta bort ur linjen
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function StepButton({
  file,
  name,
  role,
}: {
  file?: string;
  name: string;
  role: "guest" | "sales";
}) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  if (!file) return null;

  return (
    <div>
      <Button
        className="w-full"
        onClick={() =>
          setMessage(
            role === "sales"
              ? `${file} finns inte i prototypen. I skarpt läge levereras en signerad, loggad nedladdning.`
              : "STEP-filer kräver inloggning. Prototypen levererar inga CAD-filer.",
          )
        }
      >
        Ladda ner STEP
      </Button>
      {message ? <p className="mt-1 text-[11px] leading-relaxed text-muted">{message}</p> : null}
    </div>
  );
}

function formatSek(amount: number): string {
  return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(amount)} kr`;
}
