import { describe, expect, it } from "vitest";
import { localizeMachine, missingTranslations } from "@/lib/machineText";
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
