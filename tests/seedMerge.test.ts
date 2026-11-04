import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LibraryDocument } from "@/lib/machineSchema";
import { mergeSeedInto } from "@/lib/seedMerge";

const seed: LibraryDocument = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "library.json"), "utf-8"),
);

describe("mergeSeedInto", () => {
  it("lämnar ett komplett bibliotek orört", () => {
    const { document, changed } = mergeSeedInto(seed, seed);
    expect(changed).toBe(false);
    expect(document).toBe(seed);
  });

  it("fyller på grundmaskiner och prisrader som databasen saknar", () => {
    const stored: LibraryDocument = JSON.parse(JSON.stringify(seed));
    stored.machines = stored.machines.filter((m) => m.id !== "x-elevator");
    delete stored.priceBook.entries["x-elevator"];
    const { document, changed } = mergeSeedInto(stored, seed);
    expect(changed).toBe(true);
    expect(document.machines.map((m) => m.id)).toContain("x-elevator");
    expect(document.priceBook.entries["x-elevator"]).toBeDefined();
  });

  it("ger en maskin utan modell utgångslägets modell och mått", () => {
    const stored: LibraryDocument = JSON.parse(JSON.stringify(seed));
    const tsl = stored.machines.find((m) => m.id === "tsl-multi")!;
    delete tsl.model;
    tsl.footprint = { lengthMm: 6400, widthMm: 6800, heightMm: 4600 };
    tsl.name = "Admins namn";
    const merged = mergeSeedInto(stored, seed).document.machines.find(
      (m) => m.id === "tsl-multi",
    )!;
    expect(merged.model?.glb).toBe("/models/tsl-multi.glb");
    expect(merged.footprint.lengthMm).toBe(2000);
    expect(merged.name).toBe("Admins namn");
  });

  it("skriver inte över admins ändringar på en befintlig maskin", () => {
    const stored: LibraryDocument = JSON.parse(JSON.stringify(seed));
    stored.machines[0].name = "Ändrad";
    stored.priceBook.entries[stored.machines[0].id].list = 1;
    const { document } = mergeSeedInto(stored, seed);
    expect(document.machines[0].name).toBe("Ändrad");
    expect(document.priceBook.entries[stored.machines[0].id].list).toBe(1);
  });
});
