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
  /**
   * MINST så många delar läsaren kommer att skapa.
   *
   * Det är ett golv, inte en prognos. En fil räknad till 849 delar visade
   * sig ge 87 012 i läsaren: CAD-system beskriver sammanställningar på fler
   * sätt än de som går att räkna i texten, och en delmängd som instansieras
   * djupt multipliceras på vägen. Siffran duger till att säga "den här är
   * stor" — aldrig till att säga att en fil är liten.
   */
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
/**
 * Hur mycket text som läses åt gången, och hur mycket som överlappar.
 *
 * En sträng i V8 tar slut vid drygt 512 MB, och en STEP kan vara större än
 * så — en provfil på 832 MB fällde hela räkningen med "Cannot create a
 * string longer than 0x1fffffe8 characters". Filen läses därför i bitar,
 * med ett överlapp som är längre än det längsta mönstret så att ett namn
 * som ligger över en skarv ändå räknas. En träff räknas till den bit den
 * börjar i, så överlappet ger inga dubbletter.
 */
const CHUNK_BYTES = 32 * 1024 * 1024;
const OVERLAP_BYTES = 64;

function countMatches(step: Uint8Array, patterns: RegExp[]): number[] {
  const counts = patterns.map(() => 0);
  const buffer = Buffer.from(step.buffer, step.byteOffset, step.byteLength);

  for (let start = 0; start < buffer.length; start += CHUNK_BYTES) {
    const stop = Math.min(buffer.length, start + CHUNK_BYTES + OVERLAP_BYTES);
    // STEP är ASCII. latin1 undviker att en UTF-8-avkodning snubblar på
    // namn med å, ä eller ö, och räkningen bryr sig inte om tecknen.
    const text = buffer.toString("latin1", start, stop);
    const last = stop === buffer.length;

    patterns.forEach((pattern, i) => {
      const re = new RegExp(pattern.source, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        if (last || match.index < CHUNK_BYTES) counts[i] += 1;
      }
    });
  }
  return counts;
}

/*
 * Flera stavningar av samma sak, för att golvet ska bli så högt som möjligt.
 * En solid kan vara en manifold, en skalmodell eller en facetterad kropp,
 * och instansieringen sker antingen genom sammanställningsposter eller genom
 * mappade objekt.
 */
const SOLIDS = [
  /MANIFOLD_SOLID_BREP/,
  /SHELL_BASED_SURFACE_MODEL/,
  /FACETED_BREP/,
  /BREP_WITH_VOIDS/,
];
const OCCURRENCES = [/NEXT_ASSEMBLY_USAGE_OCCURRENCE/, /MAPPED_ITEM/];

/**
 * Räknar delarna i en STEP utan att läsa geometrin.
 *
 * Antalet meshar läsaren producerar är soliderna plus instanserna av dem.
 * Hade vi bara räknat soliderna hade 500 skruvar av samma sort sett ut som
 * en enda del.
 */
export function surveyStepText(step: Uint8Array): StepSurvey {
  const counts = countMatches(step, [...SOLIDS, ...OCCURRENCES]);
  const solids = counts.slice(0, SOLIDS.length).reduce((a, b) => a + b, 0);
  const occurrences = counts.slice(SOLIDS.length).reduce((a, b) => a + b, 0);
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
    `Filen innehåller minst ${survey.estimatedParts.toLocaleString("sv-SE")} delar. ` +
    `STEP-läsaren rymmer ungefär ${PART_LIMIT.toLocaleString("sv-SE")} innan dess 2 GB tar ` +
    "slut, och varken toleransen, gränsen för smådelar eller --heap ändrar det: minnet går " +
    "åt till delarna, inte till trianglarna. Exportera en STEP utan skruv, kablage och " +
    "inköpta komponenter — konfiguratorn behöver maskinens form och mått, inte varje gänga — " +
    "eller konvertera filen i ett program som kör OpenCascade nativt och mata in GLB:n i stället."
  );
}
