import { describe, expect, it } from "vitest";
import { localizeMachine, missingTranslations, textKey, translatableTexts } from "@/lib/machineText";
import { machineSchema } from "@/lib/machineSchema";
import { BUILTIN_LIBRARY } from "@/lib/library";

/**
 * Maskinens namn och beskrivning på kundens språk, med svenskan som reserv.
 */
const base = BUILTIN_LIBRARY.machines.find((m) => m.id === "rullbana")!;

describe("översatta maskinnamn", () => {
  it("visar översättningen när den finns", () => {
    const machine = { ...base, translations: { de: { name: "Rollenbahn", summary: "Angetriebene Rollen." } } };
    const de = localizeMachine(machine, "de");
    expect(de.name).toBe("Rollenbahn");
    expect(de.summary).toBe("Angetriebene Rollen.");
  });

  it("faller tillbaka på svenskan för det som saknas", () => {
    const machine = { ...base, translations: { en: { name: "Roller conveyor" } } };
    expect(localizeMachine(machine, "en").summary).toBe(base.summary);
    expect(localizeMachine(machine, "de").name).toBe(base.name);
    expect(localizeMachine(machine, "sv")).toBe(machine);
  });

  it("tomma fält räknas som saknade", () => {
    const machine = { ...base, translations: { en: { name: "  ", summary: "" } } };
    expect(localizeMachine(machine, "en").name).toBe(base.name);
    expect(missingTranslations(machine)).toEqual(["en", "de"]);
  });

  it("admins schema tar emot översättningar", () => {
    const parsed = machineSchema.safeParse({
      ...base,
      translations: { en: { name: "Roller conveyor", summary: "Driven rollers." } },
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
  });
});

describe("översatta inställningar", () => {
  const withSettings = {
    ...base,
    options: [
      { id: "o1", name: "Tillval ett" },
      { id: "o2", name: "Tillval två" },
    ],
    parameters: [
      {
        id: "p1",
        label: "Utförande",
        type: "select" as const,
        choices: [
          { value: "a", label: "Val A", priceDelta: 100 },
          { value: "b", label: "Val B" },
        ],
      },
    ],
  };
  const option = withSettings.options[0];
  const select = withSettings.parameters!.find((p) => p.type === "select")!;
  const choice = select.choices![0];

  const translated = {
    ...withSettings,
    translations: {
      de: {
        texts: {
          [textKey.option(option.id)]: "Zubehör DE",
          [textKey.paramLabel(select.id)]: "Auswahl DE",
          [textKey.paramChoice(select.id, choice.value)]: "Wahl DE",
        },
      },
    },
  };

  it("översätter tillval, parametrar och val men behåller id, värden och priser", () => {
    const de = localizeMachine(translated, "de");
    expect(de.options[0]).toEqual({ ...option, name: "Zubehör DE" });
    const p = de.parameters!.find((x) => x.id === select.id)!;
    expect(p.label).toBe("Auswahl DE");
    expect(p.choices![0]).toEqual({ ...choice, label: "Wahl DE" });
    expect(de.name).toBe(withSettings.name);
  });

  it("det som saknas visas på svenska", () => {
    const en = localizeMachine(translated, "en");
    expect(en).toBe(translated);
    const de = localizeMachine(translated, "de");
    if (withSettings.options[1]) expect(de.options[1].name).toBe(withSettings.options[1].name);
    if (select.choices![1]) expect(de.parameters!.find((x) => x.id === select.id)!.choices![1].label).toBe(select.choices![1].label);
  });

  it("listar alla texter för admin och räknar språket ofullständigt tills de finns", () => {
    const keys = translatableTexts(withSettings).map((t) => t.key);
    expect(keys).toContain(textKey.option(option.id));
    expect(keys).toContain(textKey.paramChoice(select.id, choice.value));
    const all = Object.fromEntries(keys.map((k) => [k, "x"]));
    const complete = { ...withSettings, translations: { en: { name: "N", texts: all } } };
    expect(missingTranslations(complete)).toEqual(["de"]);
    expect(missingTranslations({ ...complete, translations: { en: { name: "N" } } })).toEqual(["en", "de"]);
  });

  it("admins schema tar emot inställningarnas texter", () => {
    const parsed = machineSchema.safeParse(translated);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
  });
});

describe("enheter", () => {
  it("räknas inte som saknade", () => {
    const machine = {
      ...base,
      options: [],
      variants: undefined,
      parameters: [{ id: "t", label: "Takt", type: "number" as const, unit: "mm" }],
      translations: {
        en: { name: "N", texts: { [textKey.paramLabel("t")]: "Rate" } },
        de: { name: "N", texts: { [textKey.paramLabel("t")]: "Takt" } },
      },
    };
    expect(missingTranslations(machine)).toEqual([]);
  });
});
