import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { machineSchema } from "@/lib/machineSchema";
import { BUILTIN_MACHINES } from "@/lib/library";

/**
 * Kör den riktiga STEP-konverteringen mot en STEP-fil och kontrollerar att det
 * som kommer ut går att använda. Testet bevisar kedjan i stället för att
 * beskriva den — går den sönder märks det här, inte när en maskin ska in.
 */

const SAMPLE = "node_modules/occt-import-js/test/testfiles/cax-if/as1-oc-214.stp";
const SCRIPT = "scripts/step-to-glb.mjs";

function convert(extra: string[] = []) {
  const out = mkdtempSync(path.join(tmpdir(), "glb-"));
  const stdout = execFileSync(
    "node",
    [SCRIPT, SAMPLE, "--id", "provkorning", "--out", out, "--min-part", "5", ...extra],
    { encoding: "utf-8" },
  );
  const card = JSON.parse(readFileSync(path.join(out, "provkorning.card.json"), "utf-8"));
  const glb = readFileSync(path.join(out, "provkorning.glb"));
  return { out, stdout, card, glb };
}

describe("STEP → GLB", () => {
  it("producerar en giltig GLB", () => {
    const { glb } = convert();
    // glTF-binärt: magic "glTF", version 2, och längden i huvudet stämmer.
    expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    expect(glb.length).toBeGreaterThan(1000);
  });

  it("krymper filen rejält jämfört med källan", () => {
    const { card } = convert();
    expect(card.stats.glbBytes).toBeLessThan(card.stats.stepBytes / 5);
  });

  it("skriver portar och modellreferens som maskinschemat godkänner", () => {
    const { card } = convert();
    // Testfilen är en 20 cm stor CAx-IF-modell, inte en maskin, så
    // fotavtrycket underkänns med rätta av schemat. Det som ska stämma är
    // portarna och modellreferensen — det är dem konverteraren producerar.
    const machine = {
      ...BUILTIN_MACHINES.find((m) => m.id === "rullbana")!,
      id: card.id,
      ports: card.ports.map((p: { pos: { x: number } }) => ({
        ...p,
        pos: { ...p.pos, x: Math.min(p.pos.x, 6000) },
      })),
      model: { glb: card.model.glb },
      dimensionsVerified: card.dimensionsVerified,
    };
    const result = machineSchema.safeParse(machine);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("varnar när måtten inte kan vara en maskin", () => {
    const { card, stdout } = convert();
    // Fel längdenhet i STEP är det vanligaste felet i en CAD-leverans.
    expect(card.warnings.length).toBeGreaterThan(0);
    expect(card.warnings.join(" ")).toMatch(/längdenhet|för låg/);
    expect(stdout).toContain("VARNING");
  });

  it("portförslaget ligger på fotavtryckets kanter", () => {
    const { card } = convert();
    const inPort = card.ports.find((p: { role: string }) => p.role === "in");
    const outPort = card.ports.find((p: { role: string }) => p.role === "out");
    expect(inPort.pos.x).toBe(0);
    expect(outPort.pos.x).toBe(card.footprint.lengthMm);
    expect(inPort.pos.y).toBe(Math.round(card.footprint.widthMm / 2));
  });

  it("markerar måtten som okontrollerade", () => {
    const { card } = convert();
    // Måtten kommer ur geometrin, men portlägen och nollpunkt är gissningar
    // som en konstruktör måste bekräfta innan de visas för kund.
    expect(card.dimensionsVerified).toBe(false);
  });

  it("grövre tolerans ger färre trianglar", () => {
    const fine = convert(["--tolerance", "0.05"]).card.stats.trianglesIn;
    const coarse = convert(["--tolerance", "5"]).card.stats.trianglesIn;
    expect(coarse).toBeLessThan(fine);
  });

  it("--min-part utelämnar smådelar", () => {
    const all = convert(["--min-part", "1"]).card.stats;
    const filtered = convert(["--min-part", "40"]).card.stats;
    expect(filtered.partsKept).toBeLessThan(all.partsKept);
    expect(filtered.trianglesIn).toBeLessThan(all.trianglesIn);
  });

  it("skriver en proxy när den efterfrågas", () => {
    const { out, card } = convert(["--proxy"]);
    expect(card.model.proxy).toBeTruthy();
    expect(existsSync(path.join(out, "provkorning.proxy.glb"))).toBe(true);
  });
});

describe("exempelmodellen i repot", () => {
  it("finns och är en giltig GLB", () => {
    const glb = readFileSync("public/models/exempel.glb");
    expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
  });

  it("inget inbyggt bibliotek pekar på exempelmodellen", () => {
    // Exempelfilen är ett bevis på att kedjan fungerar, inte maskindata.
    const bound = BUILTIN_MACHINES.filter((m) => m.model?.glb.includes("exempel"));
    expect(bound).toHaveLength(0);
  });
});
