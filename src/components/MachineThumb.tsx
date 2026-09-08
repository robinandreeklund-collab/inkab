"use client";

import type { Machine } from "@/lib/types";

/**
 * Miniatyr i maskinlistorna. Visar admins uppladdade bild när det finns en,
 * annars en skalenlig skiss av fotavtrycket så att man ändå ser proportionerna.
 */
export function MachineThumb({
  machine,
  className = "h-8 w-11",
  resolveSrc,
}: {
  machine: Machine;
  className?: string;
  /**
   * Låter admin-vyn peka på en bild som ännu inte är sparad på servern.
   * Utan resolver hämtas bilden via sitt id.
   */
  resolveSrc?: (assetId: string) => string | null;
}) {
  const image = machine.images?.[0];
  const src = image ? (resolveSrc ? resolveSrc(image) : `/api/library/asset/${image}`) : null;

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={`${className} flex-none border border-divider bg-white object-cover`}
      />
    );
  }

  const { lengthMm, widthMm } = machine.footprint;
  const ratio = widthMm / Math.max(lengthMm, 1);
  const boxWidth = 34;
  const boxHeight = Math.max(4, Math.min(22, boxWidth * ratio));

  return (
    <div className={`${className} flex flex-none items-center justify-center border border-divider bg-paper`}>
      <svg width="100%" height="100%" viewBox="0 0 44 26" aria-hidden>
        <rect
          x={(44 - boxWidth) / 2}
          y={(26 - boxHeight) / 2}
          width={boxWidth}
          height={boxHeight}
          fill="#ffffff"
          stroke="#1d1f20"
          strokeOpacity="0.45"
          strokeWidth="1"
        />
        {machine.ports.length > 0 ? (
          <>
            <circle cx={(44 - boxWidth) / 2} cy={13} r="1.8" fill="#5980a6" />
            <circle cx={(44 + boxWidth) / 2} cy={13} r="1.8" fill="#1d2d3d" />
          </>
        ) : null}
      </svg>
    </div>
  );
}
