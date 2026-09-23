import { describe, expect, it } from "vitest";
import { buildSystem, machineDigest, roleAndDomain, RULE_BOOK } from "@/lib/ai/prompt";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Systemprompten mot verkligheten.
 *
 * Prompten är text och kompilatorn läser den inte. Den beskrev portkedjor,
 * grenar, fem flödesfrågor och sju regler som tagits bort — allt sådant som
 * ingenting säger ifrån om. Testerna här är det enda som håller den ärlig.
 */
const rulesSource = readFileSync(path.join(process.cwd(), "src/lib/rules.ts"), "utf-8");
const koderIKoden = new Set([...rulesSource.matchAll(/code: "(R-\d{3})"/g)].map((m) => m[1]));
const koderIPrompten = new Set([...RULE_BOOK.matchAll(/^(R-\d{3})\s/gm)].map((m) => m[1]));

describe("regelverket i prompten", () => {
  it("nämner varje regel som faktiskt finns", () => {
    expect([...koderIKoden].filter((k) => !koderIPrompten.has(k)).sort()).toEqual([]);
  });

  it("nämner ingen regel som tagits bort", () => {
    expect([...koderIPrompten].filter((k) => !koderIKoden.has(k)).sort()).toEqual([]);
  });
});

describe("prompten beskriver den anläggning som finns", () => {
  const hela = [roleAndDomain("sv"), RULE_BOOK, machineDigest(BUILTIN_LIBRARY)].join("\n");

  it("erbjuder inga verktygsargument som tagits bort", () => {
    // Prosan får gärna säga att grenar och matarlinjer inte finns — det är
    // just vad modellen behöver veta. Argumentnamnen är entydiga: står de
    // här tror modellen att den kan skicka dem.
    for (const borta of ["branchOutPortId", "branchFromInstanceId", "outPortId", "atIndex"]) {
      expect(hela, `prompten nämner ${borta}`).not.toContain(borta);
    }
  });

  it("talar inte om flödesfrågor som tagits bort", () => {
    for (const borta of ["infeedFrom", "controlDeskSide", "stickerMagazineSide", "finalConveyorLengthMm"]) {
      expect(hela, `prompten nämner ${borta}`).not.toContain(borta);
    }
  });

  it("säger att maskinerna står där de ställs", () => {
    expect(hela).toContain("Maskinerna står där de ställs");
  });

  it("förbjuder belopp", () => {
    expect(roleAndDomain("sv")).toContain("PRISER");
    expect(roleAndDomain("sv")).toContain("aldrig ett belopp");
  });
});

describe("prompten följer kundens språk", () => {
  it("ber om svar på kundens språk", () => {
    expect(roleAndDomain("de")).toContain("tyska");
    expect(roleAndDomain("en")).toContain("engelska");
    expect(roleAndDomain("sv")).toContain("svenska");
  });

  it("faller tillbaka på svenska för ett okänt språk", () => {
    expect(roleAndDomain("fr")).toContain("svenska");
  });

  it("skyddar maskinnamnen från översättning", () => {
    expect(roleAndDomain("de")).toContain("översätt aldrig ett maskinnamn");
  });
});

describe("maskinbiblioteket i prompten", () => {
  const digest = machineDigest(BUILTIN_LIBRARY);

  it("bär varje maskins namn och beskrivning, så frågor går att svara på", () => {
    for (const m of BUILTIN_LIBRARY.machines) {
      expect(digest).toContain(m.id);
      expect(digest).toContain(m.name);
      expect(digest).toContain(m.summary);
    }
  });

  it("beskriver portarna som vad maskinen klarar, inte som kopplingar", () => {
    expect(digest).toContain("Tar emot:");
    expect(digest).toContain("Lämnar:");
    expect(digest).not.toContain("Förval ut");
  });

  it("byggs med språket inbakat", () => {
    const de = buildSystem(BUILTIN_LIBRARY, "de").map((b) => b.text).join("\n");
    expect(de).toContain("tyska");
  });
});
