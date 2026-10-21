import { describe, expect, it } from "vitest";
import {
  AREA_ORDER,
  COUNTED,
  OPTIONAL,
  areaNumber,
  firstOpenArea,
  isAreaDone,
  migrateArea,
  nextArea,
  previousArea,
  type Area,
} from "@/lib/areas";
import { computeLayout } from "@/lib/layout";
import { emptyConfig, templateConfig } from "@/lib/templates";

/**
 * Stegen och när de är klara.
 *
 * Menyn visar en bock vid varje steg som är klart och pekar ut nästa. Det
 * måste följa konfigurationen, inte vad kunden råkar ha klickat på — och
 * mätaren ska inte påstå att halva arbetet är gjort innan det börjat.
 */

const none = new Set<Area>();

describe("stegens ordning", () => {
  it("går från lokalen till offerten", () => {
    expect(AREA_ORDER).toEqual(["site", "plant", "product", "quote"]);
    expect(nextArea("site")).toBe("plant");
    expect(previousArea("site")).toBeNull();
    expect(nextArea("quote")).toBeNull();
  });

  it("räknar tre steg; paketet är valfritt och har inget nummer", () => {
    expect(COUNTED).toEqual(["site", "plant", "quote"]);
    expect(OPTIONAL.has("product")).toBe(true);
    expect(areaNumber("site")).toBe(1);
    expect(areaNumber("plant")).toBe(2);
    expect(areaNumber("quote")).toBe(3);
    expect(areaNumber("product")).toBeNull();
  });
});

describe("när ett steg är klart", () => {
  it("en tom konfiguration börjar i lokalen med noll av tre", () => {
    const config = emptyConfig();
    const layout = computeLayout(config);
    expect(firstOpenArea(config, layout, none)).toBe("site");
    expect(
      COUNTED.filter((a) => isAreaDone(a, config, layout, none)),
    ).toHaveLength(0);
  });

  it("en mall bockar inte av lokalen: hallens mått är fortfarande en gissning", () => {
    const config = templateConfig("strolinje");
    const layout = computeLayout(config);
    expect(isAreaDone("site", config, layout, none)).toBe(false);
    expect(isAreaDone("plant", config, layout, none)).toBe(true);
    expect(firstOpenArea(config, layout, none)).toBe("site");
  });

  it("ändrat hallmått bockar av lokalen", () => {
    const config = emptyConfig();
    config.hall.lengthMm = 60000;
    expect(isAreaDone("site", config, computeLayout(config), none)).toBe(true);
  });

  it("lokalen går att bocka av för hand, anläggningen och offerten inte", () => {
    const config = templateConfig("strolinje");
    config.hall.lengthMm = 15000;
    const layout = computeLayout(config);
    expect(isAreaDone("site", config, layout, new Set<Area>(["site"]))).toBe(
      true,
    );
    expect(isAreaDone("plant", config, layout, new Set<Area>(["plant"]))).toBe(
      false,
    );
    expect(isAreaDone("quote", config, layout, new Set<Area>(["quote"]))).toBe(
      false,
    );
  });

  it("anläggningen är inte klar så länge regelverket hittar fel", () => {
    const config = templateConfig("strolinje");
    config.hall.lengthMm = 15000;
    expect(isAreaDone("plant", config, computeLayout(config), none)).toBe(
      false,
    );
  });

  it("paketet räknas som rört först när ett värde ändrats", () => {
    const config = emptyConfig();
    const layout = computeLayout(config);
    expect(isAreaDone("product", config, layout, none)).toBe(false);
    config.product.targetPackagesPerHour += 4;
    expect(isAreaDone("product", config, layout, none)).toBe(true);
  });

  it("det valfria steget står aldrig i vägen för nästa", () => {
    const config = templateConfig("strolinje");
    config.hall.lengthMm = 60000;
    const layout = computeLayout(config);
    // Lokalen och anläggningen klara, paketet orört: nästa är offerten.
    expect(firstOpenArea(config, layout, none)).toBe("quote");
  });
});

describe("sparade steg från den gamla menyn", () => {
  it("de nio ytorna pekas om till sina steg", () => {
    expect(migrateArea("hall")).toBe("site");
    expect(migrateArea("walls")).toBe("site");
    expect(migrateArea("zones")).toBe("site");
    expect(migrateArea("truck")).toBe("site");
    expect(migrateArea("machines")).toBe("plant");
    expect(migrateArea("line")).toBe("plant");
    expect(migrateArea("points")).toBe("plant");
    expect(migrateArea("product")).toBe("product");
    expect(migrateArea("quote")).toBe("quote");
  });

  it("ett nytt steg går igenom orört, och okänt faller bort", () => {
    expect(migrateArea("site")).toBe("site");
    expect(migrateArea("hittepå")).toBeNull();
  });
});
