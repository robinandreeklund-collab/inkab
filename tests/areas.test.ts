import { describe, expect, it } from "vitest";
import { AREA_ORDER, firstOpenArea, isAreaDone, nextArea, previousArea } from "@/lib/areas";
import { computeLayout } from "@/lib/layout";
import { emptyConfig, templateConfig } from "@/lib/templates";

/**
 * Ytorna och när de är klara.
 *
 * Menyn visar en bock vid varje yta som är klar och pekar ut nästa steg.
 * Det måste följa konfigurationen, inte vad kunden råkar ha klickat på.
 */

const none = new Set<never>();

describe("ytornas ordning", () => {
  it("går från lokalen till offerten", () => {
    expect(AREA_ORDER[0]).toBe("hall");
    expect(AREA_ORDER[AREA_ORDER.length - 1]).toBe("quote");
    expect(nextArea("hall")).toBe("walls");
    expect(previousArea("hall")).toBeNull();
    expect(nextArea("quote")).toBeNull();
  });
});

describe("när en yta är klar", () => {
  it("en tom konfiguration börjar med hallen", () => {
    const config = emptyConfig();
    expect(firstOpenArea(config, computeLayout(config), none)).toBe("hall");
  });

  it("en ändrad hall, en port och en maskin bockas av av sig själva", () => {
    const config = emptyConfig();
    config.hall.lengthMm = 60000;
    config.drawn.push({ id: "d", kind: "door", name: "Port A", x: 0, y: 0, l: 4000, w: 300, h: 5000 });
    const layout = computeLayout(config);
    expect(isAreaDone("hall", config, layout, none)).toBe(true);
    expect(isAreaDone("walls", config, layout, none)).toBe(true);
    expect(isAreaDone("machines", config, layout, none)).toBe(false);
    expect(firstOpenArea(config, layout, none)).toBe("zones");
  });

  it("en yta kunden bockat av räknas som klar", () => {
    const config = emptyConfig();
    expect(firstOpenArea(config, computeLayout(config), new Set(["hall", "walls"] as const))).toBe("zones");
  });

  it("linjen är inte klar så länge regelverket hittar fel", () => {
    const config = templateConfig("strolinje");
    config.hall.lengthMm = 15000;
    expect(isAreaDone("line", config, computeLayout(config), none)).toBe(false);
  });
});
