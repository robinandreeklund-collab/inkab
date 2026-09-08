"use client";

import { padBox } from "@/lib/projection";
import { meters } from "@/lib/format";
import type { Box, Configuration, LayoutResult } from "@/lib/types";

/**
 * Planritningen på offertunderlaget.
 *
 * Egen komponent, inte CadView i utskriftsläge. Den interaktiva vyn har
 * handtag, hovertillstånd, rutnät och diagnostikbrickor som inte hör hemma på
 * ett papper — och ett papper behöver i stället måttsättning, skalstock och
 * positionsnummer som pekar in i maskinlistan. Det är två olika ritningar av
 * samma geometri.
 *
 * Allt är svart, vitt och grått: underlaget skrivs ofta ut i svartvitt, och
 * en ritning som bara går att läsa i färg är ingen ritning.
 */

const PAD_MM = 2500;
/** Ritningens bredd i användarenheter. Höjden följer av proportionerna. */
const SHEET = 1000;

export function QuotePlan({
  config,
  layout,
}: {
  config: Configuration;
  layout: LayoutResult;
}) {
  const hall: Box = { x: 0, y: 0, l: config.hall.lengthMm, w: config.hall.widthMm };

  const boxes: Box[] = [hall, layout.bounds];
  for (const d of config.drawn) boxes.push({ x: d.x, y: d.y, l: d.l, w: d.w });
  const content: Box = {
    x: Math.min(...boxes.map((b) => b.x)),
    y: Math.min(...boxes.map((b) => b.y)),
    l: 0,
    w: 0,
  };
  content.l = Math.max(...boxes.map((b) => b.x + b.l)) - content.x;
  content.w = Math.max(...boxes.map((b) => b.y + b.w)) - content.y;

  // Plats under och till vänster om ritningen för måttlinjerna.
  const view = padBox(content, PAD_MM);
  view.x -= PAD_MM;
  view.l += PAD_MM;
  view.w += PAD_MM;

  /** En linjebredd som ser likadan ut oavsett hur stor anläggningen är. */
  const u = view.l / SHEET;
  const text = (size: number) => ({ fontSize: u * size });

  const machines = layout.placements.filter((p) => !p.aux);
  const aux = layout.placements.filter((p) => p.aux);

  return (
    <figure className="m-0">
      <svg
        viewBox={`${view.x} ${view.y} ${view.l} ${view.w}`}
        className="block w-full"
        style={{ aspectRatio: `${view.l} / ${view.w}` }}
        role="img"
        aria-label={`Planritning över ${config.projectName}`}
      >
        <defs>
          <pattern
            id="q-truck"
            width={u * 26}
            height={u * 26}
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line y2={u * 26} stroke="#1d1f20" strokeOpacity="0.28" strokeWidth={u * 3} />
          </pattern>
          <pattern
            id="q-nogo"
            width={u * 18}
            height={u * 18}
            patternTransform="rotate(-45)"
            patternUnits="userSpaceOnUse"
          >
            <line y2={u * 18} stroke="#1d1f20" strokeOpacity="0.45" strokeWidth={u * 3} />
          </pattern>
          <marker
            id="q-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="#1d1f20" />
          </marker>
        </defs>

        <rect x={view.x} y={view.y} width={view.l} height={view.w} fill="#fff" />

        {/* Hallen */}
        <rect
          x={hall.x}
          y={hall.y}
          width={hall.l}
          height={hall.w}
          fill="none"
          stroke="#1d1f20"
          strokeWidth={u * 3}
        />

        {/* Ritade objekt under maskinerna */}
        {config.drawn.map((d) => {
          const common = { x: d.x, y: d.y, width: d.l, height: d.w };
          if (d.kind === "wall") {
            return <rect key={d.id} {...common} fill="#1d1f20" fillOpacity="0.75" />;
          }
          if (d.kind === "door") {
            return (
              <g key={d.id}>
                <rect {...common} fill="#fff" stroke="#1d1f20" strokeWidth={u * 2} />
                <line
                  x1={d.x}
                  y1={d.y}
                  x2={d.x + d.l}
                  y2={d.y + d.w}
                  stroke="#1d1f20"
                  strokeWidth={u * 1.5}
                />
              </g>
            );
          }
          return (
            <g key={d.id}>
              <rect
                {...common}
                fill={d.kind === "truck" ? "url(#q-truck)" : "url(#q-nogo)"}
                stroke="#1d1f20"
                strokeOpacity="0.6"
                strokeWidth={u * 1.5}
                strokeDasharray={`${u * 12} ${u * 8}`}
              />
              <text
                x={d.x + d.l / 2}
                y={d.y + d.w / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#1d1f20"
                className="num"
                {...text(16)}
              >
                {d.name || (d.kind === "truck" ? "Truckgata" : "Spärrad yta")}
              </text>
            </g>
          );
        })}

        {/* Maskinzoner, streckade */}
        {layout.placements.map((p) =>
          p.zones
            .filter((z) => z.type === "clearance")
            .map((z, i) => (
              <rect
                key={`${p.instanceId}-z${i}`}
                x={z.box.x}
                y={z.box.y}
                width={z.box.l}
                height={z.box.w}
                fill="none"
                stroke="#1d1f20"
                strokeOpacity="0.3"
                strokeWidth={u}
                strokeDasharray={`${u * 6} ${u * 6}`}
              />
            )),
        )}

        {/* Flödet: från startpunkt genom kedjan till slutpunkt */}
        <FlowLine config={config} layout={layout} u={u} />

        {/* Maskinerna */}
        {layout.placements.map((p) => (
          <g key={p.instanceId}>
            <rect
              x={p.bbox.x}
              y={p.bbox.y}
              width={p.bbox.l}
              height={p.bbox.w}
              fill={p.aux ? "#fff" : "#e7e7ea"}
              stroke="#1d1f20"
              strokeWidth={u * 2}
              strokeDasharray={p.aux ? `${u * 8} ${u * 5}` : undefined}
            />
            <text
              x={p.bbox.x + p.bbox.l / 2}
              y={p.bbox.y + p.bbox.w / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#1d1f20"
              className="num"
              {...text(p.aux ? 15 : 22)}
            >
              {p.aux ? shortLabel(p.machine.name) : p.pos}
            </text>
          </g>
        ))}

        <Dimensions hall={hall} view={view} u={u} />
        <ScaleBar view={view} u={u} />
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <Legend swatch={<span className="inline-block h-2 w-3 border border-ink bg-[#e7e7ea]" />}>
          Maskin, siffran är positionen i maskinlistan
        </Legend>
        {aux.length > 0 ? (
          <Legend
            swatch={<span className="inline-block h-2 w-3 border border-dashed border-ink" />}
          >
            Pulpet och magasin
          </Legend>
        ) : null}
        {config.drawn.some((d) => d.kind === "truck") ? (
          <Legend swatch={<span className="inline-block h-2 w-3 border border-ink bg-paper" />}>
            Truckgata
          </Legend>
        ) : null}
        <Legend
          swatch={<span className="inline-block h-2 w-3 border border-dashed border-divider" />}
        >
          Maskinzon — fritt utrymme som måste hållas
        </Legend>
        <span>
          Måtten är i meter. Ritningen är genererad ur konfigurationen och ersätter inte en
          måttsatt anläggningsritning.
        </span>
      </figcaption>
    </figure>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

/** Flödespilen: startpunkt → maskinernas mittpunkter → slutpunkt. */
function FlowLine({
  config,
  layout,
  u,
}: {
  config: Configuration;
  layout: LayoutResult;
  u: number;
}) {
  const chain = layout.placements.filter((p) => !p.aux);
  if (chain.length === 0) return null;

  const points = [
    config.flow.startPoint,
    ...chain.map((p) => ({ x: p.bbox.x + p.bbox.l / 2, y: p.bbox.y + p.bbox.w / 2 })),
    ...(config.flow.endPoint ? [config.flow.endPoint] : []),
  ];

  return (
    <g>
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="#1d1f20"
        strokeOpacity="0.45"
        strokeWidth={u * 2}
        strokeDasharray={`${u * 14} ${u * 8}`}
        markerEnd="url(#q-arrow)"
      />
      <circle cx={points[0].x} cy={points[0].y} r={u * 7} fill="#fff" stroke="#1d1f20" strokeWidth={u * 2} />
      <text
        x={points[0].x}
        y={points[0].y - u * 14}
        textAnchor="middle"
        fill="#1d1f20"
        className="num"
        fontSize={u * 16}
      >
        Inmatning
      </text>
      {config.flow.endPoint ? (
        <text
          x={config.flow.endPoint.x}
          y={config.flow.endPoint.y - u * 14}
          textAnchor="middle"
          fill="#1d1f20"
          className="num"
          fontSize={u * 16}
        >
          Avlämning
        </text>
      ) : null}
    </g>
  );
}

/** Måttlinjer för hallens ytterkant: längden under, bredden till vänster. */
function Dimensions({ hall, view, u }: { hall: Box; view: Box; u: number }) {
  const below = view.y + view.w - u * 45;
  const left = view.x + u * 45;
  const tick = u * 8;

  return (
    <g stroke="#1d1f20" fill="#1d1f20" strokeWidth={u * 1.5}>
      {/* Längd */}
      <line x1={hall.x} y1={below} x2={hall.x + hall.l} y2={below} markerStart="url(#q-arrow)" markerEnd="url(#q-arrow)" />
      <line x1={hall.x} y1={below - tick} x2={hall.x} y2={below + tick} />
      <line x1={hall.x + hall.l} y1={below - tick} x2={hall.x + hall.l} y2={below + tick} />
      <text
        x={hall.x + hall.l / 2}
        y={below - u * 12}
        textAnchor="middle"
        stroke="none"
        className="num"
        fontSize={u * 16}
      >
        {meters(hall.l)} m
      </text>

      {/* Bredd */}
      <line x1={left} y1={hall.y} x2={left} y2={hall.y + hall.w} markerStart="url(#q-arrow)" markerEnd="url(#q-arrow)" />
      <line x1={left - tick} y1={hall.y} x2={left + tick} y2={hall.y} />
      <line x1={left - tick} y1={hall.y + hall.w} x2={left + tick} y2={hall.y + hall.w} />
      <text
        x={left - u * 12}
        y={hall.y + hall.w / 2}
        textAnchor="middle"
        stroke="none"
        className="num"
        fontSize={u * 16}
        transform={`rotate(-90 ${left - u * 12} ${hall.y + hall.w / 2})`}
      >
        {meters(hall.w)} m
      </text>
    </g>
  );
}

/**
 * Skalstock i stället för skalangivelse. Ritningen skalas om av utskriften och
 * av skärmen, så "1:100" vore en osanning — en skalstock följer med.
 */
function ScaleBar({ view, u }: { view: Box; u: number }) {
  // Ungefär en tiondel av bredden, avrundat till 1, 2, 5 eller 10 meter.
  const raw = view.l / 10;
  const steps = [1000, 2000, 5000, 10_000, 20_000, 50_000];
  const length = steps.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best));
  const x = view.x + u * 70;
  const y = view.y + view.w - u * 14;

  return (
    <g>
      <rect x={x} y={y - u * 6} width={length / 2} height={u * 6} fill="#1d1f20" />
      <rect
        x={x + length / 2}
        y={y - u * 6}
        width={length / 2}
        height={u * 6}
        fill="#fff"
        stroke="#1d1f20"
        strokeWidth={u}
      />
      <text x={x} y={y + u * 14} fill="#1d1f20" className="num" fontSize={u * 15}>
        0
      </text>
      <text x={x + length} y={y + u * 14} textAnchor="middle" fill="#1d1f20" className="num" fontSize={u * 15}>
        {meters(length, 0)} m
      </text>
    </g>
  );
}

/** Kortar "Manöverpulpet" till något som får plats i en liten ruta. */
function shortLabel(name: string): string {
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}
