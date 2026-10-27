import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PART_LIMIT, surveyStepText, tooManyParts } from "@/lib/cad/stepSurvey";

/**
 * Att räkna delarna innan man läser filen.
 *
 * Poängen är att ett besked ska komma på en sekund i stället för efter tio
 * minuters tessellering som ändå slutar med slut minne. Gissningen behöver
 * inte vara exakt — den ska skilja 9 000 delar från 87 000 — men den måste
 * träffa rätt storleksordning, annars stoppar den filer som hade gått.
 */

const read = (p: string) => new Uint8Array(readFileSync(p));
const CUBE =
  "node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp";
const ASSEMBLY =
  "node_modules/occt-import-js/test/testfiles/cax-if/as1-oc-214.stp";

describe("surveyStepText", () => {
  it("räknar en ensam solid som en del", () => {
    const survey = surveyStepText(read(CUBE));
    expect(survey.solids).toBe(1);
    expect(survey.estimatedParts).toBe(1);
    expect(survey.verdict).toBe("ok");
  });

  it("räknar instanserna i en sammanställning, inte bara soliderna", () => {
    /*
     * Filen har 5 egna solider som sätts in 13 gånger. Läsaren gör 18
     * meshar av den, och det är instanserna som kostar minne — hade vi
     * bara räknat soliderna hade en sammanställning med 500 skruvar av
     * samma sort sett ut som en enda del.
     */
    const survey = surveyStepText(read(ASSEMBLY));
    expect(survey.solids).toBe(5);
    expect(survey.occurrences).toBe(13);
    expect(survey.estimatedParts).toBe(18);
  });

  it("tiger om en fil som går att läsa", () => {
    expect(tooManyParts(surveyStepText(read(ASSEMBLY)))).toBeNull();
  });
});

describe("tooManyParts", () => {
  const stor = {
    solids: 900,
    occurrences: 86_112,
    estimatedParts: 87_012,
    estimatedSeconds: 99_999,
    verdict: "för-stor" as const,
  };

  it("säger hur många delar filen minst har och var gränsen går", () => {
    const message = tooManyParts(stor)!;
    // Svenska tusentalsavgränsare är ett hårt mellanslag, inte ett vanligt.
    expect(message).toContain((87_012).toLocaleString("sv-SE"));
    expect(message).toContain(PART_LIMIT.toLocaleString("sv-SE"));
  });

  it("säger att toleransen och --heap inte hjälper", () => {
    /*
     * Mätt: samma fil med 2 mm och 200 mm tolerans landade på exakt samma
     * 412 MB. Rådet att skruva på toleransen för att spara minne är alltså
     * fel, och det är precis den jakten folk skickades ut på förut.
     */
    const message = tooManyParts(stor)!;
    expect(message).toMatch(/varken toleransen/i);
    expect(message).toContain("--heap");
    expect(message).toMatch(/delarna, inte till trianglarna/);
  });
});

/**
 * En sträng i V8 tar slut vid drygt 512 MB, och en STEP kan vara större.
 * En provfil på 832 MB fällde hela räkningen med "Cannot create a string
 * longer than 0x1fffffe8 characters", och då blev beskedet ett kryptiskt
 * JavaScript-fel i stället för en räkning. Filen läses i bitar nu, och
 * provet här bevakar att skarvarna varken tappar eller dubblerar träffar.
 */
describe("stora filer", () => {
  it("räknar lika över en skarv som utan", () => {
    const rad =
      "#1=MANIFOLD_SOLID_BREP('a',#2);#3=NEXT_ASSEMBLY_USAGE_OCCURRENCE('b');\n";
    // Drygt två bitar, så att minst två skarvar passeras.
    const text = rad.repeat(Math.ceil((32 * 1024 * 1024 * 2.2) / rad.length));
    const survey = surveyStepText(new Uint8Array(Buffer.from(text, "latin1")));
    const gånger = text.split("MANIFOLD_SOLID_BREP").length - 1;

    expect(survey.solids).toBe(gånger);
    expect(survey.occurrences).toBe(gånger);
    expect(survey.estimatedParts).toBe(gånger * 2);
  });
});
