"use client";

import { useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { meters, parseMeters } from "@/lib/format";
import { suggestTruckZone } from "@/lib/solver";
import { DEFAULT_HALL, TEMPLATES, templateConfig } from "@/lib/templates";
import { Button, cx, NumberInput, Tip } from "./ui";
import { TOOL_HELP } from "./toolHelp";
import type { Tool } from "@/store/useConfigStore";

/**
 * Kom igång, steg för steg.
 *
 * Den som öppnar ritytan för första gången ska inte behöva gissa var man
 * börjar. Guiden visar stegen i den ordning de är lättast att göra — lokalen
 * först, sedan det som redan finns i den, sedan flödet och sist maskinerna —
 * och bockar av dem själv utifrån vad som faktiskt finns i ritningen. Nästa
 * steg är utfällt och säger varför det behövs.
 *
 * Inget steg är tvingande. Den som hellre börjar med maskinerna gör det, och
 * guiden hoppar dit.
 */

type Step = {
  id: string;
  title: string;
  why: string;
  done: boolean;
  /** Det som går att göra direkt i steget. */
  body: React.ReactNode;
};

export function GettingStarted() {
  const {
    config,
    layout,
    guideOpen,
    toggleGuide,
    setTool,
    tool,
    update,
    addDrawn,
    setFlowPoint,
    addFlowMarker,
    load,
    setScreen,
  } = useConfigStore();
  /** Steg som kunden själv har bockat av — hallen har alltid ett mått, och alla lokaler har inte portar. */
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  if (!guideOpen) {
    return (
      <div className="absolute bottom-10 left-3 z-10">
        <Tip title="Kom igång" body="Visa stegen för att rita lokalen och bygga linjen." side="top">
          <Button size="sm" onClick={() => toggleGuide(true)} className="shadow-sm">
            <span aria-hidden>?</span> Kom igång
          </Button>
        </Tip>
      </div>
    );
  }

  const drawn = config.drawn;
  const has = (kind: string) => drawn.some((d) => d.kind === kind);

  const toolButton = (value: Tool) => (
    <Tip title={TOOL_HELP[value].title} body={TOOL_HELP[value].body} shortcut={TOOL_HELP[value].shortcut}>
      <Button size="sm" active={tool === value} onClick={() => setTool(value)}>
        {TOOL_HELP[value].label}
      </Button>
    </Tip>
  );

  const steps: Step[] = [
    {
      id: "hall",
      title: "Ställ in hallens yta",
      why: "Allt annat mäts mot lokalen: var väggarna går, hur lång linjen får bli och om trucken kommer runt.",
      done:
        !!confirmed.hall ||
        config.hall.lengthMm !== DEFAULT_HALL.lengthMm ||
        config.hall.widthMm !== DEFAULT_HALL.widthMm,
      body: (
        <>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            {(
              [
                ["Längd", "lengthMm", 5000],
                ["Bredd", "widthMm", 5000],
                ["Höjd", "clearHeightMm", 2000],
              ] as const
            ).map(([label, key, min]) => (
              <label key={key} className="block">
                <span className="kicker mb-0.5 block">{label} m</span>
                <NumberInput
                  value={meters(config.hall[key])}
                  onCommit={(raw) => {
                    const mm = parseMeters(raw);
                    if (mm !== null && mm >= min) update((d) => void (d.hall[key] = mm));
                  }}
                />
              </label>
            ))}
          </div>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            Eller dra i hallens högra kant, nederkant eller hörn direkt i ritningen.
          </p>
          <Button size="sm" variant="primary" onClick={() => setConfirmed((c) => ({ ...c, hall: true }))}>
            Måtten stämmer
          </Button>
        </>
      ),
    },
    {
      id: "doors",
      title: "Rita in portarna",
      why: "Portarna är där trucken kör in och ut. De styr var linjen kan börja och sluta.",
      done: has("door") || !!confirmed.doors,
      body: (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            Dra längs hallens kant eller en vägg. Avståndet till närmaste vägg på båda sidor visas
            medan du drar, och när du flyttar porten efteråt.
          </p>
          <div className="flex flex-wrap gap-1">
            {toolButton("door")}
            {toolButton("wall")}
            <Button size="sm" variant="ghost" onClick={() => setConfirmed((c) => ({ ...c, doors: true }))}>
              Inga portar
            </Button>
          </div>
        </>
      ),
    },
    {
      id: "zones",
      title: "Markera no-go- och truckzoner",
      why: "Pelare, trappor och elcentraler får inte byggas över, och trucken behöver sin gata. Regelverket kontrollerar båda.",
      done: has("nogo") || has("truck") || !!confirmed.zones,
      body: (
        <>
          <div className="mb-2 flex flex-wrap gap-1">
            {toolButton("nogo")}
            {toolButton("truck")}
          </div>
          <div className="flex flex-wrap gap-1">
            <Tip
              title="Föreslå hämtzon"
              body="Lägger en hämtzon vid linjens utlastning, på den sida trucken hämtar från. Flytta eller ändra den efteråt."
            >
              <Button
                size="sm"
                onClick={() => {
                  const zone = suggestTruckZone(layout.bounds, "x+", config.flow.truckPickupSide);
                  addDrawn({ id: `truck-${Date.now().toString(36)}`, kind: "truck", name: "Hämtzon", ...zone, h: 0 });
                }}
              >
                + Hämtzon
              </Button>
            </Tip>
            <Button size="sm" variant="ghost" onClick={() => setConfirmed((c) => ({ ...c, zones: true }))}>
              Behövs inte
            </Button>
          </div>
        </>
      ),
    },
    {
      id: "points",
      title: "Sätt start och slut",
      why: "Linjen byggs från startpunkten — där paketen kommer in — mot slutpunkten, där de lämnas.",
      done: !!config.flow.endPoint || (config.flow.markers?.length ?? 0) > 0 || !!confirmed.points,
      body: (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            Dra START och SLUT i ritningen. Finns det flera tänkbara lägen, lägg till alternativ och
            skriv varför — de kan göras aktiva senare.
          </p>
          <div className="flex flex-wrap gap-1">
            {!config.flow.endPoint ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  setFlowPoint("endPoint", {
                    x: Math.max(0, layout.bounds.x + layout.bounds.l),
                    y: config.flow.startPoint.y,
                  })
                }
              >
                Sätt slutpunkt
              </Button>
            ) : null}
            <Button size="sm" onClick={() => addFlowMarker("start")}>
              + Alternativ start
            </Button>
            <Button size="sm" onClick={() => addFlowMarker("end")}>
              + Alternativt slut
            </Button>
          </div>
        </>
      ),
    },
    {
      id: "machines",
      title: "Välj maskiner",
      why: "Maskinerna placeras i ordning från startpunkten. Klicka i listan till vänster, eller börja från en mall.",
      done: config.line.length > 0,
      body: (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            Klicka på en maskin under <b>1 · Maskiner</b> till vänster så läggs den sist i linjen.
          </p>
          <div className="flex flex-col gap-1">
            {TEMPLATES.slice(0, 2).map((template) => (
              <Tip key={template.id} title={template.name} body={template.description} side="right" block>
                <Button
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    // Mallens maskiner, men lokalen och punkterna som redan ritats.
                    const next = templateConfig(template.id);
                    next.hall = config.hall;
                    next.drawn = config.drawn;
                    next.flow = { ...next.flow, ...pickPoints(config.flow) };
                    load(next, { note: `Lade in mallen ${template.name}` });
                  }}
                >
                  Mall: {template.name}
                </Button>
              </Tip>
            ))}
          </div>
        </>
      ),
    },
    {
      id: "quote",
      title: "Ta fram offertunderlaget",
      why: "Pris, ritning och maskinlista i ett dokument som går att dela.",
      done: false,
      body: (
        <Button size="sm" variant="primary" onClick={() => setScreen("quote")}>
          Sammanställ offertunderlag
        </Button>
      ),
    },
  ];

  const nextIndex = steps.findIndex((s) => !s.done);
  const expanded = openId ?? steps[nextIndex]?.id ?? null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="blueprint absolute left-3 top-3 z-10 w-[300px] bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-divider px-3 py-2">
        <div>
          <div className="kicker">Kom igång</div>
          <div className="text-sm">
            {doneCount} av {steps.length} steg klara
          </div>
        </div>
        <Tip title="Stäng guiden" body="Den kan öppnas igen med knappen Kom igång nere till vänster." side="left">
          <Button variant="ghost" size="sm" onClick={() => toggleGuide(false)}>
            Stäng
          </Button>
        </Tip>
      </div>
      <div className="h-1 bg-paper">
        <div className="h-1 bg-accent transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <ol className="scroll-thin max-h-[60vh] overflow-y-auto">
        {steps.map((step, index) => {
          const isOpen = expanded === step.id;
          const isNext = index === nextIndex;
          return (
            <li key={step.id} className="border-b border-divider last:border-0">
              <Tip
                block
                side="right"
                title={isNext ? `Nästa steg: ${step.title}` : step.title}
                body={step.why}
              >
                <button
                  onClick={() => setOpenId(isOpen ? "" : step.id)}
                  className={cx(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]",
                    isNext ? "bg-accent/10" : "hover:bg-paper",
                  )}
                  aria-expanded={isOpen}
                >
                  <span
                    className={cx(
                      "num flex h-5 w-5 flex-none items-center justify-center border text-[11px]",
                      step.done
                        ? "border-accent bg-accent text-white"
                        : isNext
                          ? "border-accent text-accent"
                          : "border-divider text-muted",
                    )}
                  >
                    {step.done ? "✓" : index + 1}
                  </span>
                  <span className={cx("min-w-0 flex-1", step.done && "text-muted")}>{step.title}</span>
                  {isNext ? <span className="kicker text-accent">Nästa</span> : null}
                </button>
              </Tip>
              {isOpen ? (
                <div className="px-3 pb-3 pl-10">
                  <p className="mb-2 text-[11px] leading-relaxed">{step.why}</p>
                  {step.body}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Start, slut och alternativen följer med när en mall läggs in över det man ritat. */
function pickPoints(flow: ReturnType<typeof useConfigStore.getState>["config"]["flow"]) {
  return {
    startPoint: flow.startPoint,
    endPoint: flow.endPoint,
    startComment: flow.startComment,
    endComment: flow.endComment,
    markers: flow.markers,
    fitToEndPoint: flow.fitToEndPoint,
  };
}
