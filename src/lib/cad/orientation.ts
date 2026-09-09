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
