import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { defaultConfig, lineItem } from "@/lib/templates";
import { BUILTIN_LIBRARY } from "@/lib/library";
import { LOCALES, MESSAGES, preferredLocale, translate } from "@/lib/i18n/index-pure";

/**
 * Sajten på tre språk.
 *
 * Svenskan är källspråket och de andra två faller tillbaka på den. Det som
 * behöver bevakas är därför inte att varje ord är rätt — det avgör en
 * människa — utan att inget saknas, att platshållarna överlever
 * översättningen, och att regelverket verkligen talar kundens språk.
 */
describe("ordlistan", () => {
  it("har samma nycklar i alla språk", () => {
    const svenska = Object.keys(MESSAGES.sv).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort(), `saknade nycklar i ${locale}`).toEqual(svenska);
    }
  });

  it("behåller varje platshållare i översättningen", () => {
    const hallare = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, sv] of Object.entries(MESSAGES.sv)) {
      for (const locale of LOCALES) {
        expect(hallare(MESSAGES[locale][key]), `${key} i ${locale}`).toEqual(hallare(sv));
      }
    }
  });

  it("lämnar ingen text oöversatt genom att kopiera svenskan rakt av", () => {
    // Siffror, förkortningar och egennamn är rimligen lika. Längre meningar
    // som står ordagrant kvar är däremot glömda.
    const glomda = Object.entries(MESSAGES.sv).filter(
      ([key, sv]) =>
        sv.length > 25 && MESSAGES.en[key] === sv && MESSAGES.de[key] === sv,
    );
    expect(glomda.map(([k]) => k)).toEqual([]);
  });

  it("fyller platshållare", () => {
    expect(translate("de", "status.bottleneck", { name: "Rullbana" })).toBe("Engpass: Rullbana");
  });

  it("faller tillbaka på svenskan för en nyckel som saknas", () => {
    expect(translate("en", "finns.inte.alls")).toBe("finns.inte.alls");
  });

  it("läser webbläsarens språkval", () => {
    expect(preferredLocale(["de-AT", "en-GB"])).toBe("de");
    expect(preferredLocale(["fr-FR", "en-US"])).toBe("en");
    expect(preferredLocale(["fr-FR"])).toBe("sv");
  });
});

describe("regelverket talar kundens språk", () => {
  /** Två maskiner på varandra ger R-103. */
  const krock = () => {
    const config = defaultConfig();
    const a = lineItem("rullbana");
    const b = lineItem("rullbana");
    a.pos = { x: 6000, y: 10000 };
    b.pos = { x: 6000, y: 10000 };
    config.line = [a, b];
    return config;
  };

  const text = (locale: (typeof LOCALES)[number]) =>
    computeLayout(krock(), BUILTIN_LIBRARY, (key, vars) => translate(locale, key, vars))
      .diagnostics.find((d) => d.code === "R-103")!;

  it("svarar på svenska utan översättare", () => {
    const d = computeLayout(krock(), BUILTIN_LIBRARY).diagnostics.find((x) => x.code === "R-103")!;
    expect(d.title).toBe("Maskiner överlappar");
  });

  it("svarar på engelska", () => {
    expect(text("en").title).toBe("Machines overlap");
    expect(text("en").detail).toContain("run into each other");
  });

  it("svarar på tyska", () => {
    expect(text("de").title).toBe("Maschinen überlappen");
    expect(text("de").detail).toContain("überschneiden sich");
  });

  it("behåller maskinnamnen som de står i katalogen", () => {
    // Katalogen är kundens data och översätts inte av oss.
    expect(text("de").detail).toContain("Rullbana");
  });
});
