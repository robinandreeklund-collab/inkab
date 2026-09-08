"use client";

import { DIR_VEC } from "@/lib/geometry";
import { meters } from "@/lib/format";
import type { Machine } from "@/lib/types";

/**
 * Ritar maskinens fotavtryck, portar och zoner i dess lokala system. Det är
 * här man ser direkt om en port hamnat på fel kant eller pekar åt fel håll —
 * det vanligaste felet när maskindata matas in.
 */
export function MachinePreview({ machine }: { machine: Machine }) {
  const { lengthMm: L, widthMm: W } = machine.footprint;
  const zoneBoxes = machine.zones.map((z) => z.box);
  const minX = Math.min(0, ...zoneBoxes.map((b) => b.x));
  const minY = Math.min(0, ...zoneBoxes.map((b) => b.y));
  const maxX = Math.max(L, ...zoneBoxes.map((b) => b.x + b.l));
  const maxY = Math.max(W, ...zoneBoxes.map((b) => b.y + b.w));

  const pad = Math.max(L, W) * 0.12 + 400;
  const view = { x: minX - pad, y: minY - pad, l: maxX - minX + pad * 2, w: maxY - minY + pad * 2 };
  const u = view.l / 520;
  const arrow = Math.max(L, W) * 0.1;

  return (
    <div className="border border-divider bg-paper">
      <svg
        viewBox={`${view.x} ${view.y} ${view.l} ${view.w}`}
        className="h-[240px] w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {machine.zones.map((zone, i) => (
          <g key={i}>
            <rect
              x={zone.box.x}
              y={zone.box.y}
              width={zone.box.l}
              height={zone.box.w}
              fill="none"
              stroke={zone.type === "safety" ? "#b45309" : zone.type === "pit" ? "#9f1239" : "#5980a6"}
              strokeOpacity="0.6"
              strokeWidth={u}
              strokeDasharray={`${u * 5} ${u * 3}`}
            />
            <text
              x={zone.box.x + u * 4}
              y={zone.box.y + u * 12}
              fontSize={u * 10}
              fill="#71717a"
              className="num"
            >
              {zone.label}
            </text>
          </g>
        ))}

        <rect x={0} y={0} width={L} height={W} fill="#ffffff" stroke="#1d1f20" strokeWidth={u * 1.6} />

        {/* Flödesriktningen i lokalt system går alltid längs +X. */}
        <path
          d={`M${L * 0.5 - arrow} ${W / 2}h${arrow * 2}`}
          stroke="#d4d4d7"
          strokeWidth={u * 1.2}
        />

        {machine.ports.map((port) => {
          const v = DIR_VEC[port.dir];
          const isIn = port.role === "in";
          return (
            <g key={port.id}>
              <circle
                cx={port.pos.x}
                cy={port.pos.y}
                r={u * 5}
                fill={isIn ? "#5980a6" : "#1d2d3d"}
              />
              <path
                d={`M${port.pos.x} ${port.pos.y}l${v.x * arrow} ${v.y * arrow}`}
                stroke={isIn ? "#5980a6" : "#1d2d3d"}
                strokeWidth={u * 1.8}
              />
              <text
                x={port.pos.x + v.x * arrow * 1.25}
                y={port.pos.y + v.y * arrow * 1.25 + u * 4}
                textAnchor="middle"
                fontSize={u * 11}
                fill="#1d1f20"
                className="num"
              >
                {port.id}
              </text>
            </g>
          );
        })}

        <text x={L / 2} y={-u * 6} textAnchor="middle" fontSize={u * 11} fill="#71717a" className="num">
          {meters(L)} m
        </text>
        <text
          x={-u * 8}
          y={W / 2}
          textAnchor="middle"
          fontSize={u * 11}
          fill="#71717a"
          className="num"
          transform={`rotate(-90 ${-u * 8} ${W / 2})`}
        >
          {meters(W)} m
        </text>
      </svg>
      <p className="border-t border-divider px-2 py-1 text-[11px] text-muted">
        Lokalt system: origo uppe till vänster, X längs flödet, Y tvärs. Ifylld cirkel = inport,
        mörk = utport. Pilen visar portens riktning.
      </p>
    </div>
  );
}
