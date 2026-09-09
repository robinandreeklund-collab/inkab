/**
 * Modellens orientering.
 *
 * En STEP kommer sällan in rättvänd. CAD-system är oense om vilken axel som
 * är upp — SolidWorks och Inventor ritar Z upp, en del exportkedjor Y — och
 * konstruktören som ritade maskinen valde inte nödvändigtvis flödesriktningen
 * som X. Det är inte fel i filen, bara en annan konvention.
 *
 * Därför justeras riktningen vid uppritningen i stället för vid
 * konverteringen: att vrida en modell ska vara ett klick och synas direkt,
 * inte kräva att man letar rätt på STEP-filen och konverterar om.
 */

export type ModelOrientation = {
  /** Vilken axel som var upp i källfilen. Z är det vanliga. */
  upAxis?: "z" | "y";
  /** Vridning kring upp-axeln, i grader. */
  yawDeg?: 0 | 90 | 180 | 270;
  /** Spegling tvärs flödet, för maskiner som ritats åt andra hållet. */
  flipped?: boolean;
};

export const YAW_STEPS = [0, 90, 180, 270] as const;

/**
 * Rotationen i radianer, i three.js koordinater (Y upp).
 *
 * Konverteraren lägger källans Z på glTF:ens Y. Var källan i själva verket
 * Y-upp hamnar modellens uppriktning på Z, och behöver resas: en vridning om
 * −90° kring X för +Z till +Y.
 */
export function orientationEuler(orientation: ModelOrientation | undefined): {
  x: number;
  y: number;
} {
  const yaw = ((orientation?.yawDeg ?? 0) * Math.PI) / 180;
  return { x: orientation?.upAxis === "y" ? -Math.PI / 2 : 0, y: yaw };
}

/**
 * Måtten som modellen får efter vridningen.
 *
 * Fotavtrycket mäts på den okorrigerade geometrin, så längd, bredd och höjd
 * byter plats när modellen reses eller vrids ett kvarts varv. Permutationen
 * är exakt — det här är axelbyten, inte uppskattningar.
 */
export function orientedFootprint(
  footprint: { lengthMm: number; widthMm: number; heightMm: number },
  orientation: ModelOrientation | undefined,
): { lengthMm: number; widthMm: number; heightMm: number } {
  let { lengthMm, widthMm, heightMm } = footprint;

  // Res modellen: det som mättes som bredd är i själva verket höjden.
  if (orientation?.upAxis === "y") {
    [widthMm, heightMm] = [heightMm, widthMm];
  }
  // Ett kvarts varv byter längd och bredd. Ett halvt varv ändrar inga mått.
  if (orientation?.yawDeg === 90 || orientation?.yawDeg === 270) {
    [lengthMm, widthMm] = [widthMm, lengthMm];
  }

  return { lengthMm, widthMm, heightMm };
}

/** Kort text för gränssnittet: "Z upp · 90° · speglad". */
export function orientationLabel(orientation: ModelOrientation | undefined): string {
  const parts = [orientation?.upAxis === "y" ? "Y upp" : "Z upp"];
  if (orientation?.yawDeg) parts.push(`${orientation.yawDeg}°`);
  if (orientation?.flipped) parts.push("speglad");
  return parts.join(" · ");
}

/* ── Automatisk riktning ───────────────────────────────────────────────── */

/**
 * Hur mycket bättre den bästa riktningen måste vara än den näst bästa för att
 * få användas utan att någon tittat.
 *
 * En absolut gräns vore fel mått: bibliotekets fotavtryck är ofta en
 * uppskattning, så även den rätta riktningen kan ha stor avvikelse. Frågan är
 * inte hur nära den kommer, utan om formen alls skiljer lägena åt. Gör den
 * inte det — en nästan kvadratisk maskin — ska verktyget avstå i stället för
 * att singla slant.
 */
export const AMBIGUITY_RATIO = 0.7;

export type OrientationFit = {
  orientation: ModelOrientation;
  footprint: { lengthMm: number; widthMm: number; heightMm: number };
  /** 0 = samma form. Lägre är bättre. */
  error: number;
  /** Sant när formen pekar tydligt ut det här läget framför de andra. */
  confident: boolean;
};

/** Jämför form, inte storlek: båda normeras mot sitt största mått. */
function shapeError(
  a: { lengthMm: number; widthMm: number; heightMm: number },
  b: { lengthMm: number; widthMm: number; heightMm: number },
): number {
  const na = Math.max(a.lengthMm, a.widthMm, a.heightMm) || 1;
  const nb = Math.max(b.lengthMm, b.widthMm, b.heightMm) || 1;
  const keys = ["lengthMm", "widthMm", "heightMm"] as const;
  return keys.reduce((sum, key) => {
    const x = a[key] / na;
    const y = b[key] / nb;
    return sum + Math.abs(x - y) / Math.max(x, y, 1e-6);
  }, 0);
}

/**
 * Väljer den riktning vars mått bäst liknar maskinens fotavtryck.
 *
 * Ett CAD-system ritar inte alltid längden längs X, och vilken axel som är
 * upp varierar. I stället för att gissa en konvention — och gissa fel —
 * provas alla lägen mot måtten som redan står i biblioteket. Bara fyra är
 * intressanta: ett halvt varv ändrar inga mått, så 0° och 180° ger samma
 * fotavtryck, liksom 90° och 270°. Vilket av de två paren som är rätt avgörs
 * av hur maskinen ser ut, inte av dess mått, och lämnas åt ögat.
 */
export function bestOrientation(
  measured: { lengthMm: number; widthMm: number; heightMm: number },
  target: { lengthMm: number; widthMm: number; heightMm: number },
): OrientationFit {
  const candidates: ModelOrientation[] = [
    { upAxis: "z", yawDeg: 0 },
    { upAxis: "z", yawDeg: 90 },
    { upAxis: "y", yawDeg: 0 },
    { upAxis: "y", yawDeg: 90 },
  ];

  const ranked = candidates
    .map((orientation) => {
      const footprint = orientedFootprint(measured, orientation);
      return { orientation, footprint, error: shapeError(footprint, target) };
    })
    .sort((a, b) => a.error - b.error);

  const [best, runnerUp] = ranked;
  return { ...best, confident: best.error < runnerUp.error * AMBIGUITY_RATIO };
}
