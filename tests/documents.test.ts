import { describe, expect, it } from "vitest";
import {
  DOCUMENT_KIND_LABEL,
  formatBytes,
  guessKind,
  isDocumentKind,
  isOrderState,
  ORDERED_KINDS,
} from "@/lib/documents";

/**
 * Maskinernas underlag.
 *
 * Gissningen av filsort är en bekvämlighet, inte en sanning — den som laddar
 * upp kan ändra. Men den ska gissa rätt på det som faktiskt kommer ur ett
 * konstruktionskontor, annars är den bara i vägen.
 */

describe("guessKind", () => {
  it("känner igen CAD-filerna på ändelsen", () => {
    expect(guessKind("Rullbana_stp.STEP")).toBe("step");
    expect(guessKind("underrede.stp")).toBe("step");
    expect(guessKind("ram.dwg")).toBe("cad");
    expect(guessKind("montage.iam")).toBe("cad");
  });

  it("känner igen verkstadens underlag på namnet", () => {
    expect(guessKind("Balklista rullbana 6m.xlsx")).toBe("beamlist");
    expect(guessKind("skarfiler-sidoplat.dxf")).toBe("cad");
    expect(guessKind("Skärfil plåt 4mm.pdf")).toBe("cutting");
    expect(guessKind("elschema-tsl.pdf")).toBe("electrical");
    expect(guessKind("Monteringsanvisning.pdf")).toBe("manual");
  });

  it("tar ritning för det som är en ritning", () => {
    expect(guessKind("A-30-1-100.pdf")).toBe("drawing");
    expect(guessKind("foto.jpg")).toBe("drawing");
  });

  it("faller tillbaka på övrigt", () => {
    expect(guessKind("anteckningar.txt")).toBe("other");
    expect(guessKind("utanändelse")).toBe("other");
  });
});

describe("sorter och lägen", () => {
  it("vaktar att bara kända värden kommer in", () => {
    expect(isDocumentKind("cutting")).toBe(true);
    expect(isDocumentKind("hittepå")).toBe(false);
    expect(isOrderState("ordered")).toBe(true);
    expect(isOrderState("kanske")).toBe(false);
  });

  it("vet vad som normalt beställs hos någon annan", () => {
    // Att en skärfil finns i systemet betyder inte att den är beställd.
    expect(ORDERED_KINDS).toContain("cutting");
    for (const kind of ORDERED_KINDS) expect(DOCUMENT_KIND_LABEL[kind]).toBeTruthy();
  });
});

describe("formatBytes", () => {
  it("skriver storleken som en människa läser den", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(34_575)).toBe("35 kB");
    expect(formatBytes(2_929_252)).toBe("2,9 MB");
  });
});
