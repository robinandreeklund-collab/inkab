import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { makeLibrary } from "@/lib/library";
import { collectIssues, libraryDocumentSchema } from "@/lib/machineSchema";
import { templateConfig } from "@/lib/templates";
import type { Machine } from "@/lib/types";

/**
 * Det versionshanterade utgångsläget, `data/library.json`.
 *
 * Servern läser filen vid varje start och faller tyst tillbaka på de inbyggda
 * maskinerna om den inte går att tolka — en rad i loggen som ingen ser, och en
 * demo som visar fel bibliotek. Samma sak med modellsökvägarna: en GLB som
 * pekar på en fil som inte committades ger en tom vy först när någon öppnar
 * den. Bägge felen hör hemma här, inte i drift.
 */

const SEED = path.join(process.cwd(), "data", "library.json");

describe.runIf(existsSync(SEED))("data/library.json", () => {
  const document = JSON.parse(readFileSync(SEED, "utf-8"));

  it("går igenom maskinschemat", () => {
    const parsed = libraryDocumentSchema.safeParse(document);
    expect(parsed.success ? [] : collectIssues(parsed.error)).toEqual([]);
  });

  it("får inte layoutmotorn att haverera", () => {
    // Samma provkörning som admin-vyn gör innan den sparar.
    const library = makeLibrary(document.machines as Machine[]);
    expect(() => computeLayout(templateConfig("strolinje"), library)).not.toThrow();
  });

  it("pekar bara på bildfiler som finns i repot", () => {
    const paths = (document.machines as Machine[])
      .flatMap((machine) => machine.images ?? [])
      .filter((entry) => entry.startsWith("/"));

    for (const url of paths) {
      const file = path.join(process.cwd(), "public", url);
      expect(existsSync(file), `${url} saknas i public/`).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    }
  });

  it("pekar bara på modellfiler som finns i repot", () => {
    const models = (document.machines as Machine[]).flatMap((machine) => [
      machine.model,
      ...(machine.variants ?? []).map((variant) => variant.model),
    ]);

    const paths = models
      .filter((model) => model)
      .flatMap((model) => [model!.glb, model!.proxy])
      .filter((url): url is string => !!url && url.startsWith("/models/"));

    expect(paths.length).toBeGreaterThan(0);
    for (const url of paths) {
      const file = path.join(process.cwd(), "public", url);
      expect(existsSync(file), `${url} saknas i public/models`).toBe(true);
      // glTF-binärt börjar med "glTF" och bär sin egen längd i huvudet.
      const data = readFileSync(file);
      expect(data.subarray(0, 4).toString("ascii")).toBe("glTF");
      expect(data.readUInt32LE(8)).toBe(statSync(file).size);
    }
  });
});
