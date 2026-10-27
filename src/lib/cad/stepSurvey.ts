/**
 * Vad en STEP-fil innehåller, läst som text.
 *
 * STEP-läsaren är OpenCascade kompilerad till WebAssembly, och den har två
 * tak som båda beror på ANTALET DELAR — inte på filens storlek och inte på
 * hur fint den tesselleras:
 *
 *   Minne  Mätt på replikerade provfiler går det ungefär 60 kB WASM-minne
 *          per del, och taket är 2 GB (se READER_MEMORY_CEILING_MB). Det
 *          ger omkring 33 000 delar innan minnet tar slut.
 *   Tid    Delarna skickas en siffra i taget över gränsen mellan C++ och
 *          JavaScript, och kostnaden växer snabbare än antalet: 500 delar
 *          tog 9 s, 2 000 tog 43 s, 6 000 tog 241 s.
 *
 * Mätningarna visar också vad som INTE hjälper: samma fil tesselerad med
 * 2 mm och med 200 mm tolerans landade på exakt 412 MB båda gångerna, trots
 * 5,7 gånger färre trianglar. Toleransen styr filstorleken, inte minnet.
 * Gränsen för smådelar hjälper inte heller, eftersom den sållar först efter
 * att allt redan är tesselerat.
 *
 * Därför den här modulen: att räkna delarna i texten tar en sekund, och då
 * vet man innan man startar om filen över huvud taget går att läsa. Förut
 * tog beskedet tio minuter och kom som ett minnesfel.
 */

/** Ungefär så många delar ryms i läsarens 2 GB. */
export const PART_LIMIT = 30_000;
/** Över så här många delar tar konverteringen lång tid, men den går. */
export const PART_SLOW = 10_000;

export type StepSurvey = {
  /** Egna solider i filen. */
  solids: number;
  /** Instanser av dem i sammanställningen. */
  occurrences: number;
  /** Ungefär så många delar läsaren kommer att skapa. */
  estimatedParts: number;
  /** Grov gissning på konverteringstiden, sekunder. */
  estimatedSeconds: number;
  verdict: "ok" | "långsam" | "för-stor";
};

/**
 * Hur lång tid en konvertering tar, grovt.
 *
 * Anpassad till tre mätpunkter på replikerade provfiler (500 delar 9 s,
 * 2 000 delar 43 s, 6 000 delar 241 s), vilket ger ungefär n^1,4. Siffran
 * är till för att säga "minuter" eller "timmar", inte för att vara exakt.
 */
function secondsFor(parts: number): number {
  return Math.round(241 * Math.pow(Math.max(parts, 1) / 6000, 1.4));
}

/**
 * Räknar delarna i en STEP utan att läsa geometrin.
 *
 * Antalet meshar läsaren producerar är soliderna plus instanserna av dem:
 * provat mot provfilerna stämmer det på en del när eller exakt, vilket
 * räcker gott för att skilja 9 000 från 87 000.
 */
export function surveyStepText(step: Uint8Array): StepSurvey {
  // STEP är ASCII. latin1 undviker att en UTF-8-avkodning snubblar på
  // namn med å, ä eller ö, och räkningen bryr sig inte om tecknen.
  const text = Buffer.from(step).toString("latin1");
  const count = (re: RegExp) => (text.match(re) || []).length;

  const solids = count(/MANIFOLD_SOLID_BREP/g);
  const occurrences = count(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g);
  const estimatedParts = solids + occurrences;

  return {
    solids,
    occurrences,
    estimatedParts,
    estimatedSeconds: secondsFor(estimatedParts),
    verdict:
      estimatedParts > PART_LIMIT
        ? "för-stor"
        : estimatedParts > PART_SLOW
          ? "långsam"
          : "ok",
  };
}

/** Varför filen inte går att läsa, eller null när den gör det. */
export function tooManyParts(survey: StepSurvey): string | null {
  if (survey.verdict !== "för-stor") return null;
  return (
    `Filen innehåller omkring ${survey.estimatedParts.toLocaleString("sv-SE")} delar. ` +
    `STEP-läsaren rymmer ungefär ${PART_LIMIT.toLocaleString("sv-SE")} innan dess 2 GB tar ` +
    "slut, och varken toleransen, gränsen för smådelar eller --heap ändrar det: minnet går " +
    "åt till delarna, inte till trianglarna. Exportera en STEP utan skruv, kablage och " +
    "inköpta komponenter — konfiguratorn behöver maskinens form och mått, inte varje gänga — " +
    "eller konvertera filen i ett program som kör OpenCascade nativt och mata in GLB:n i stället."
  );
}
