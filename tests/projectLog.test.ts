import { describe, expect, it } from "vitest";
import { describeChange, logAsText, logEntry } from "@/lib/projectLog";
import { BUILTIN_LIBRARY, getMachine } from "@/lib/library";
import { defaultConfig, lineItem, templateConfig } from "@/lib/templates";
import type { Configuration } from "@/lib/types";

/**
 * Projektloggen.
 *
 * Den skrivs på ett ställe — där konfigurationen byts ut — och beskriver
 * verkliga skillnader, inte avsikter. Det är hela poängen: en ny knapp kan
 * inte glömma att skriva sin rad, och raden kan inte påstå något som inte
 * hände.
 */

const nameOf = (id: string) => getMachine(id, BUILTIN_LIBRARY)?.name ?? id;
const change = (before: Configuration, after: Configuration) =>
  describeChange(before, after, nameOf);

describe("describeChange", () => {
  it("tiger när ingenting hände", () => {
    const config = templateConfig("strolinje");
    expect(change(config, JSON.parse(JSON.stringify(config)))).toBeNull();
  });

  it("namnger maskinen som lades till", () => {
    const before = defaultConfig();
    const after = JSON.parse(JSON.stringify(before)) as Configuration;
    after.line.push(lineItem("rullbana"));
    expect(change(before, after)?.text).toContain(nameOf("rullbana"));
    expect(change(before, after)?.kind).toBe("machine");
  });

  it("namnger maskinen som togs bort", () => {
    const before = templateConfig("strolinje");
    const after = JSON.parse(JSON.stringify(before)) as Configuration;
    const [removed] = after.line.splice(1, 1);
    const entry = change(before, after);
    expect(entry?.text).toContain("Tog bort");
    expect(entry?.text).toContain(nameOf(removed.machineId));
  });

  it("skriver hallens nya mått i meter", () => {
    const before = defaultConfig();
    const after = JSON.parse(JSON.stringify(before)) as Configuration;
    after.hall.lengthMm = 52_000;
    expect(change(before, after)?.text).toContain("52,0");
  });

  it("skriver flödesvalet på svenska i stället för dess kod", () => {
    const before = defaultConfig();
    const after = JSON.parse(JSON.stringify(before)) as Configuration;
    after.flow.truckPickupSide = after.flow.truckPickupSide === "left" ? "right" : "left";
    const entry = change(before, after);
    expect(entry?.kind).toBe("flow");
    expect(entry?.text).toMatch(/höger|vänster/);
  });

  it("bryr sig inte om att linjens startpunkt dras", () => {
    // Att dra linjen i vyn är inget som hörs hemma i ett underlag.
    const before = defaultConfig();
    const after = JSON.parse(JSON.stringify(before)) as Configuration;
    after.flow.startPoint = { x: 5000, y: 9000 };
    expect(change(before, after)).toBeNull();
  });

  it("namnger det ritade objektet", () => {
    const before = defaultConfig();
    const after = JSON.parse(JSON.stringify(before)) as Configuration;
    after.drawn.push({
      id: "w1",
      kind: "wall",
      name: "Vägg 1",
      x: 0,
      y: 0,
      l: 10000,
      w: 300,
      h: 3000,
    });
    expect(change(before, after)?.text).toBe("Ritade Vägg 1");
  });
});

describe("logAsText", () => {
  it("ger en läsbar utskrift med tid, slag och detaljer", () => {
    const entries = [
      logEntry("upload", "Skickade in ritning.pdf"),
      logEntry("ask", "Frågade assistenten", "Hur lång blir linjen?"),
    ];
    const text = logAsText(entries, "Sågverket");
    expect(text).toContain("Projektlogg — Sågverket");
    expect(text).toContain("[Underlag] Skickade in ritning.pdf");
    expect(text).toContain("Hur lång blir linjen?");
  });
});
