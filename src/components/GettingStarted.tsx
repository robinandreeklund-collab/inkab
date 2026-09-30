"use client";

import { useState, type ReactNode } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { meters, parseMeters } from "@/lib/format";
import { suggestTruckZone } from "@/lib/solver";
import { DEFAULT_HALL } from "@/lib/templates";
import { useT } from "@/lib/i18n";
import { Button, cx, NumberInput, Tip } from "./ui";
import { toolHelp } from "./toolHelp";
import type { Tool } from "@/store/useConfigStore";

/**
 * Kom igång, steg för steg.
 *
 * Den som öppnar ritytan för första gången ska inte behöva gissa var man
 * börjar. Guiden visar stegen i den ordning de är lättast att göra — lokalen
 * först, sedan det som redan finns i den, sedan var paketen går in och ut och
 * sist maskinerna — och bockar av dem själv utifrån vad som faktiskt finns i
 * ritningen. Nästa steg är utfällt och säger varför det behövs.
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
  body: ReactNode;
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
    addFlowMarker,
    setScreen,
  } = useConfigStore();
  const t = useT();
  /** Steg som kunden själv har bockat av — hallen har alltid ett mått, och alla lokaler har inte portar. */
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const confirm = (id: string) => setConfirmed((c) => ({ ...c, [id]: true }));

  if (!guideOpen) {
    return (
      <div className="absolute bottom-10 left-3 z-10">
        <Tip title={t("guide.kicker")} body={t("guide.openTip")} side="top">
          <Button size="sm" onClick={() => toggleGuide(true)} className="shadow-sm">
            <span aria-hidden>?</span> {t("guide.kicker")}
          </Button>
        </Tip>
      </div>
    );
  }

  const has = (kind: string) => config.drawn.some((d) => d.kind === kind);

  const toolButton = (value: Tool) => {
    const help = toolHelp(t, value);
    return (
      <Tip title={help.title} body={help.body} shortcut={help.shortcut}>
        <Button size="sm" active={tool === value} onClick={() => setTool(value)}>
          {help.label}
        </Button>
      </Tip>
    );
  };

  const steps: Step[] = [
    {
      id: "hall",
      title: t("guide.hall.title"),
      why: t("guide.hall.why"),
      done:
        !!confirmed.hall ||
        config.hall.lengthMm !== DEFAULT_HALL.lengthMm ||
        config.hall.widthMm !== DEFAULT_HALL.widthMm,
      body: (
        <>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            {(
              [
                ["sidebar.length", "lengthMm", 5000],
                ["sidebar.width", "widthMm", 5000],
                ["sidebar.height", "clearHeightMm", 2000],
              ] as const
            ).map(([label, key, min]) => (
              <label key={key} className="block">
                <span className="kicker mb-0.5 block">{t(label)} m</span>
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
          <p className="mb-2 text-[11px] leading-relaxed text-muted">{t("guide.hall.drag")}</p>
          <Button size="sm" variant="primary" onClick={() => confirm("hall")}>
            {t("guide.hall.ok")}
          </Button>
        </>
      ),
    },
    {
      id: "doors",
      title: t("guide.doors.title"),
      why: t("guide.doors.why"),
      done: has("door") || !!confirmed.doors,
      body: (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">{t("guide.doors.body")}</p>
          <div className="flex flex-wrap gap-1">
            {toolButton("door")}
            {toolButton("wall")}
            <Button size="sm" variant="ghost" onClick={() => confirm("doors")}>
              {t("guide.doors.none")}
            </Button>
          </div>
        </>
      ),
    },
    {
      id: "zones",
      title: t("guide.zones.title"),
      why: t("guide.zones.why"),
      done: has("nogo") || has("truck") || !!confirmed.zones,
      body: (
        <>
          <div className="mb-2 flex flex-wrap gap-1">
            {toolButton("nogo")}
            {toolButton("truck")}
          </div>
          <div className="flex flex-wrap gap-1">
            <Tip title={t("guide.zones.pickup")} body={t("guide.zones.pickupTip")}>
              <Button
                size="sm"
                onClick={() => {
                  const zone = suggestTruckZone(layout.bounds, "x+", config.flow.truckPickupSide);
                  addDrawn({ id: `truck-${Date.now().toString(36)}`, kind: "truck", name: "Hämtzon", ...zone, h: 0 });
                }}
              >
                {t("guide.zones.pickup")}
              </Button>
            </Tip>
            <Button size="sm" variant="ghost" onClick={() => confirm("zones")}>
              {t("guide.zones.none")}
            </Button>
          </div>
        </>
      ),
    },
    {
      id: "points",
      title: t("guide.points.title"),
      why: t("guide.points.why"),
      done: !!config.flow.startComment || (config.flow.markers?.length ?? 0) > 0 || !!confirmed.points,
      body: (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">{t("guide.points.body")}</p>
          <div className="flex flex-wrap gap-1">
            <Tip title={t("points.addStartTip")} body={t("points.startHelp")}>
              <Button size="sm" onClick={() => addFlowMarker("start")}>
                {t("points.addStart")}
              </Button>
            </Tip>
            <Tip title={t("points.addEndTip")} body={t("points.endHelp")}>
              <Button size="sm" onClick={() => addFlowMarker("end")}>
                {t("points.addEnd")}
              </Button>
            </Tip>
            <Button size="sm" variant="ghost" onClick={() => confirm("points")}>
              {t("guide.points.ok")}
            </Button>
          </div>
        </>
      ),
    },
    {
      id: "machines",
      title: t("guide.machines.title"),
      why: t("guide.machines.why"),
      done: config.line.length > 0,
      body: null,
    },
    {
      id: "quote",
      title: t("guide.quote.title"),
      why: t("guide.quote.why"),
      done: false,
      body: (
        <Button size="sm" variant="primary" onClick={() => setScreen("quote")}>
          {t("guide.quote.go")}
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
          <div className="kicker">{t("guide.kicker")}</div>
          <div className="text-sm">{t("guide.progress", { done: doneCount, total: steps.length })}</div>
        </div>
        <Tip title={t("guide.close")} body={t("guide.closeTip")} side="left">
          <Button variant="ghost" size="sm" onClick={() => toggleGuide(false)}>
            {t("guide.close")}
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
                title={isNext ? t("guide.nextStep", { title: step.title }) : step.title}
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
                  {isNext ? <span className="kicker text-accent">{t("guide.next")}</span> : null}
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
