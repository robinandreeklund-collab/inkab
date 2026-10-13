"use client";

import { useEffect, useState } from "react";
import { topViewOf, type TopView } from "@/lib/cad/topView";
import type { Placement } from "@/lib/types";

/**
 * Maskinens 3D-modell sedd ovanifrån, i maskinens ruta.
 *
 * Bilden är i maskinens eget läge och vrids och speglas här som maskinen. Den
 * ritas i modellens verkliga mått, med sin vridna ytterruta i maskinens hörn —
 * precis som modellen står i 3D-vyn. Utan modell, eller medan bilden tas
 * fram, syns rutan som förut.
 */
export function TopViewImage({
  placement,
  print = false,
}: {
  placement: Placement;
  /**
   * För offertens planritning: gråskala och ljusare, så att bilden håller
   * vid svartvit utskrift och måttlinjer och nummer går att läsa ovanpå.
   */
  print?: boolean;
}) {
  const [view, setView] = useState<TopView | null>(null);
  const machine = placement.machine;
  // Maskinobjektet byts vid varje omräkning av layouten; bilden hämtas bara
  // om när modellen eller dess orientering faktiskt ändras.
  const model = machine.model;
  const key = model?.glb ? `${model.glb}|${model.upAxis}|${model.yawDeg}|${model.flipped}` : "";
  useEffect(() => {
    let alive = true;
    const pending = key ? topViewOf(machine) : null;
    if (!pending) setView(null);
    pending?.then((result) => {
      if (alive) setView(result);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!view) return null;
  const quarter = placement.rotation % 180 !== 0;
  const spanX = quarter ? view.widthMm : view.lengthMm;
  const spanY = quarter ? view.lengthMm : view.widthMm;
  const cx = placement.bbox.x + spanX / 2;
  const cy = placement.bbox.y + spanY / 2;
  return (
    <image
      href={view.url}
      x={-view.lengthMm / 2}
      y={-view.widthMm / 2}
      width={view.lengthMm}
      height={view.widthMm}
      preserveAspectRatio="none"
      transform={`translate(${cx} ${cy}) rotate(${placement.rotation}) scale(1 ${placement.mirrored ? -1 : 1})`}
      pointerEvents="none"
      style={print ? { filter: "grayscale(1) contrast(1.1)", opacity: 0.75 } : undefined}
    />
  );
}

