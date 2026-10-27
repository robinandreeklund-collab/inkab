import { readFileSync } from "node:fs";
import { Document, WebIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { measureGlb } from "@/lib/cad/measureGlb";

/**
 * Att mäta upp en färdig GLB.
 *
 * Vägen in för maskiner som STEP-läsaren inte rår på, och för modeller som
 * gjorts i ett annat program. Måtten måste bli desamma som om filen
 * konverterats här, annars säger modellen och biblioteket olika saker om
 * samma maskin.
 */

describe("measureGlb", () => {
  it("mäter en riktig modell till bibliotekets mått", async () => {
    const glb = new Uint8Array(readFileSync("public/models/rullbana.glb"));
    const measured = await measureGlb(glb);
    const facit = JSON.parse(
      readFileSync("data/library.json", "utf-8"),
    ).machines.find((m: { id: string }) => m.id === "rullbana");

    // En millimeter ifrån: GLB:ns koordinater är kvantiserade, inte exakta.
    // Biblioteket bär måtten efter riktningen, mätningen före, så bredd och
    // höjd byter plats på vägen — se orientedFootprint.
    expect(
      Math.abs(measured.footprint.lengthMm - facit.footprint.widthMm),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(measured.footprint.widthMm - facit.footprint.heightMm),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(measured.footprint.heightMm - facit.footprint.lengthMm),
    ).toBeLessThanOrEqual(2);
  });

  /*
   * Avdubbleringen slår ihop likadan geometri. En sammanställning med
   * tusentals identiska skruvar blir EN mesh som används tusentals gånger,
   * och räknat på mesharna rapporterades en modell med över en miljon
   * trianglar som "12 trianglar". Det är instanserna som ritas upp, och som
   * varningen för tunga modeller ska gå på.
   */
  it("räknar trianglar per instans, inte per unik mesh", async () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    // Två trianglar som spänner en meter i varje led — måttkontrollen i
    // measureGlb kräver utbredning i alla tre riktningar.
    const primitive = doc
      .createPrimitive()
      .setAttribute(
        "POSITION",
        doc
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1]))
          .setBuffer(buffer),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType("SCALAR")
          .setArray(new Uint32Array([0, 1, 2, 0, 2, 3]))
          .setBuffer(buffer),
      );
    const mesh = doc.createMesh("ruta").addPrimitive(primitive);
    const scene = doc.createScene("scen");
    for (let i = 0; i < 50; i++) {
      scene.addChild(doc.createNode(`ruta-${i}`).setMesh(mesh));
    }

    const glb = await new WebIO().writeBinary(doc);
    const measured = await measureGlb(glb);

    expect(measured.stats.meshes).toBe(50);
    expect(measured.stats.trianglesIn).toBe(100);
  });
});
