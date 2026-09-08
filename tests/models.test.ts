import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { convertStep, suggestPorts } from "@/lib/server/stepConvert";
import { deleteModel, listModels, putModel, readModel } from "@/lib/server/store";

/**
 * Uppladdningen från admin-vyn går genom convertStep och modellagret. Testet
 * kör båda på riktigt, utan Postgres — samma väg som en server utan
 * DATABASE_URL tar.
 */

const SAMPLE = "node_modules/occt-import-js/test/testfiles/cax-if/as1-oc-214.stp";

describe("convertStep", () => {
  let result: Awaited<ReturnType<typeof convertStep>>;

  beforeAll(async () => {
    const step = new Uint8Array(readFileSync(SAMPLE));
    result = await convertStep(step, { minPartMm: 5, proxy: true });
  }, 60_000);

  it("ger en giltig GLB", () => {
    const glb = Buffer.from(result.glb);
    expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(glb.readUInt32LE(8)).toBe(glb.length);
  });

  it("ger en proxy som också är en giltig GLB", () => {
    // Att proxyn blir mindre gäller på tung geometri. Testfilen är 18 delar
    // och redan lätt, så det som ska stämma här är att filen går att läsa.
    expect(result.proxy).not.toBeNull();
    const proxy = Buffer.from(result.proxy!);
    expect(proxy.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(proxy.readUInt32LE(8)).toBe(proxy.length);
  });

  it("mäter fotavtrycket och föreslår portar på kanterna", () => {
    expect(result.footprint.lengthMm).toBeGreaterThan(0);
    const [inPort, outPort] = result.ports;
    expect(inPort.pos.x).toBe(0);
    expect(outPort.pos.x).toBe(result.footprint.lengthMm);
  });

  it("varnar när måtten inte kan vara en maskin", () => {
    // Testfilen är 20 cm stor — fel längdenhet är det vanligaste felet i en
    // CAD-leverans och ska sägas rakt ut, inte glida igenom.
    expect(result.warnings.join(" ")).toMatch(/längdenhet|för låg/);
  });

  it("avvisar något som inte är en STEP", async () => {
    await expect(convertStep(new TextEncoder().encode("inte en step"))).rejects.toThrow();
  });

  it("säger till när gränsen för smådelar tog bort allt", async () => {
    const step = new Uint8Array(readFileSync(SAMPLE));
    await expect(convertStep(step, { minPartMm: 100_000 })).rejects.toThrow(/Sänk den/);
  }, 60_000);
});

describe("suggestPorts", () => {
  it("lägger portarna mitt på kortsidorna", () => {
    const ports = suggestPorts({ lengthMm: 6000, widthMm: 1800 });
    expect(ports.map((p) => p.role)).toEqual(["in", "out"]);
    expect(ports[0].pos).toEqual({ x: 0, y: 900 });
    expect(ports[1].pos).toEqual({ x: 6000, y: 900 });
  });
});

describe("modellagret", () => {
  const data = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);

  it("lagrar, läser och tar bort en modell", async () => {
    const put = await putModel({
      id: "prov-1",
      machineId: "prov",
      name: "prov.step",
      kind: "glb",
      data,
    });
    // Utan DATABASE_URL lever modellen i minnet — och det ska sägas, inte
    // döljas, för då försvinner den vid omstart.
    expect(put.persisted).toBe(false);
    expect(put.reason).toMatch(/DATABASE_URL/);

    const read = await readModel("prov-1");
    expect(read?.data.equals(Buffer.from(data))).toBe(true);
    expect(read?.meta.bytes).toBe(data.length);

    await deleteModel("prov-1");
    expect(await readModel("prov-1")).toBeNull();
  });

  it("filtrerar listan på maskin", async () => {
    await putModel({ id: "a-1", machineId: "a", name: "a.step", kind: "glb", data });
    await putModel({ id: "b-1", machineId: "b", name: "b.step", kind: "glb", data });

    expect((await listModels("a")).map((m) => m.id)).toEqual(["a-1"]);
    expect((await listModels()).length).toBeGreaterThanOrEqual(2);

    await deleteModel("a-1");
    await deleteModel("b-1");
  });

  it("ger tillbaka null för en modell som inte finns", async () => {
    expect(await readModel("finns-inte")).toBeNull();
  });
});
