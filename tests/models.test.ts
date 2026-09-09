import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { convertStep, suggestPorts } from "@/lib/cad/stepConvert";
import { deleteModel, listModels, putModel, readModel } from "@/lib/server/store";
import { applyModelFootprint, applySuggestedPorts } from "@/lib/cad/applyModel";
import { collectIssues, machineSchema } from "@/lib/machineSchema";
import { Euler, Matrix4, Vector3 } from "three";
import {
  bestOrientation,
  orientationEuler,
  orientationLabel,
  orientedFootprint,
  YAW_STEPS,
} from "@/lib/cad/orientation";
import { BUILTIN_MACHINES } from "@/lib/library";

/**
 * convertStep är samma modul som admin-vyns web worker och CLI-skriptet kör.
 * Testet kör den på riktigt i Node, och modellagret utan Postgres — samma väg
 * som en server utan DATABASE_URL tar.
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

describe("ta över mått ur modellen", () => {
  const machine = BUILTIN_MACHINES.find((m) => m.id === "rullbana")!;

  it("flyttar in portarna i det nya fotavtrycket", () => {
    // Det här var felet: nya mått skrevs in men portarna låg kvar där de var,
    // maskinen bröt mot schemat och Spara gjorde ingenting utan att säga varför.
    const small = { lengthMm: 2000, widthMm: 800, heightMm: 700 };
    const { machine: applied, movedPorts } = applyModelFootprint(machine, small);

    expect(movedPorts.length).toBeGreaterThan(0);
    for (const port of applied.ports) {
      expect(port.pos.x).toBeLessThanOrEqual(small.lengthMm);
      expect(port.pos.y).toBeLessThanOrEqual(small.widthMm);
    }
    expect(machineSchema.safeParse(applied).success).toBe(true);
  });

  it("låter portarna vara när de redan får plats", () => {
    const bigger = { lengthMm: 12_000, widthMm: 4000, heightMm: 900 };
    const { machine: applied, movedPorts } = applyModelFootprint(machine, bigger);
    expect(movedPorts).toEqual([]);
    expect(applied.ports).toEqual(machine.ports);
  });

  it("markerar måtten som okontrollerade", () => {
    const { machine: applied } = applyModelFootprint(machine, machine.footprint);
    expect(applied.dimensionsVerified).toBe(false);
  });

  it("portförslaget utgår från maskinens eget fotavtryck", () => {
    // Inte modellens: annars hamnar portarna utanför maskinen när måtten
    // inte är övertagna.
    const applied = applySuggestedPorts(machine);
    expect(applied.ports.map((p) => p.role).sort()).toEqual(["in", "out"]);
    expect(applied.ports[1].pos.x).toBe(machine.footprint.lengthMm);
    expect(machineSchema.safeParse(applied).success).toBe(true);
  });

  it("avvisar mått som schemat inte tillåter, utan att ändra maskinen", () => {
    // En modell i fel längdenhet ger en 8 cm hög maskin. Den ska stoppas i
    // panelen, inte upptäckas som en tyst vägran att spara.
    const tooSmall = { lengthMm: 200, widthMm: 150, heightMm: 84 };
    const { machine: applied } = applyModelFootprint(machine, tooSmall);
    const parsed = machineSchema.safeParse(applied);
    expect(parsed.success).toBe(false);
    expect(collectIssues(parsed.error!).map((i) => i.path)).toContain("footprint.heightMm");
  });

  it("skriver valideringsfelen på svenska", () => {
    const parsed = machineSchema.safeParse({ ...machine, footprint: { lengthMm: 10, widthMm: 10, heightMm: 10 } });
    const messages = collectIssues(parsed.error!).map((i) => i.message);
    expect(messages.join(" ")).toContain("Måste vara minst 100");
    expect(messages.join(" ")).not.toMatch(/must be|greater than/i);
  });
});

describe("modellens riktning", () => {
  const size = { lengthMm: 6000, widthMm: 1800, heightMm: 700 };

  it("låter måtten vara när inget är vridet", () => {
    expect(orientedFootprint(size, {})).toEqual(size);
    expect(orientationEuler({})).toEqual({ x: 0, y: 0, order: "YXZ" });
  });

  it("reser en liggande modell och byter bredd mot höjd", () => {
    // Var källan Y-upp hamnade uppriktningen på djupledsaxeln; det som mättes
    // som bredd är i själva verket höjden.
    expect(orientedFootprint(size, { upAxis: "y" })).toEqual({
      lengthMm: 6000,
      widthMm: 700,
      heightMm: 1800,
    });
    expect(orientationEuler({ upAxis: "y" }).x).toBeCloseTo(-Math.PI / 2);
  });

  it("byter längd mot bredd vid ett kvarts varv", () => {
    for (const yawDeg of [90, 270] as const) {
      expect(orientedFootprint(size, { yawDeg })).toEqual({
        lengthMm: 1800,
        widthMm: 6000,
        heightMm: 700,
      });
    }
  });

  it("ändrar inga mått vid ett halvt varv", () => {
    expect(orientedFootprint(size, { yawDeg: 180 })).toEqual(size);
    expect(orientationEuler({ yawDeg: 180 }).y).toBeCloseTo(Math.PI);
  });

  it("kombinerar resning och vridning", () => {
    expect(orientedFootprint(size, { upAxis: "y", yawDeg: 90 })).toEqual({
      lengthMm: 700,
      widthMm: 6000,
      heightMm: 1800,
    });
  });

  it("beskriver riktningen i klartext", () => {
    expect(orientationLabel({})).toBe("Z upp");
    expect(orientationLabel({ upAxis: "y", yawDeg: 180, flipped: true })).toBe(
      "Y upp · 180° · speglad",
    );
  });

  it("går igenom maskinschemat", () => {
    const machine = BUILTIN_MACHINES.find((m) => m.id === "rullbana")!;
    const parsed = machineSchema.safeParse({
      ...machine,
      model: { glb: "/api/models/x", upAxis: "y", yawDeg: 270, flipped: true },
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

describe("riktningen mot konverterarens egen upp-axel", () => {
  /*
   * Konverteraren kan själv ta en upp-axel. Riktningen i biblioteket ställs i
   * stället efteråt, vid uppritningen. De två vägarna måste ge samma mått —
   * annars visar panelen ett fotavtryck som modellen inte har. Testet kör
   * båda på samma fil och jämför.
   */
  it("ger samma fotavtryck som en konvertering med Y upp", async () => {
    const step = new Uint8Array(readFileSync(SAMPLE));
    const [asZ, asY] = await Promise.all([
      convertStep(step, { minPartMm: 5, up: "z" }),
      convertStep(step, { minPartMm: 5, up: "y" }),
    ]);
    expect(orientedFootprint(asZ.footprint, { upAxis: "y" })).toEqual(asY.footprint);
  }, 60_000);
});

describe("automatisk riktning", () => {
  it("hittar riktningen på en maskin ritad med längden längs Z", () => {
    /*
     * Verkligt fall. Maskinen är 3,00 × 1,57 × 0,60 m. Konverteraren mätte
     * 1,57 × 0,60 × 3,00 (X, Y, Z), alltså Y upp och längden längs Z. Rätt
     * svar är Y upp och ett kvarts varv — och det ska hittas trots att
     * bibliotekets fotavtryck fortfarande är en grov uppskattning.
     */
    const measured = { lengthMm: 1570, widthMm: 600, heightMm: 3000 };
    const library = { lengthMm: 6000, widthMm: 1800, heightMm: 700 };

    const fit = bestOrientation(measured, library);
    // 270° och inte 90°: måtten kan inte skilja dem åt, men 270° lägger
    // längden längs +X i stället för −X efter upprätningen.
    expect(fit.orientation).toEqual({ upAxis: "y", yawDeg: 270 });
    expect(fit.footprint).toEqual({ lengthMm: 3000, widthMm: 1570, heightMm: 600 });
    // Avvikelsen är stor i absoluta tal — biblioteket säger 6 m där maskinen
    // är 3 — men formen pekar ändå entydigt ut rätt läge.
    expect(fit.confident).toBe(true);
  });

  it("låter en redan rättvänd modell vara", () => {
    const target = { lengthMm: 6000, widthMm: 1800, heightMm: 700 };
    const fit = bestOrientation(target, target);
    expect(fit.footprint).toEqual(target);
    expect(fit.error).toBeCloseTo(0);
    expect(fit.confident).toBe(true);
  });

  it("reser en modell som ligger ner", () => {
    // Måtten säger 6,0 × 0,7 × 1,8: höjden hamnade på djupledsaxeln.
    const measured = { lengthMm: 6000, widthMm: 700, heightMm: 1800 };
    const fit = bestOrientation(measured, { lengthMm: 6000, widthMm: 1800, heightMm: 700 });
    expect(fit.orientation.upAxis).toBe("y");
    expect(fit.footprint).toEqual({ lengthMm: 6000, widthMm: 1800, heightMm: 700 });
  });

  it("avstår när formen inte skiljer lägena åt", () => {
    const fit = bestOrientation(
      { lengthMm: 1000, widthMm: 1000, heightMm: 1000 },
      { lengthMm: 12_000, widthMm: 2200, heightMm: 800 },
    );
    // En kub ser likadan ut från alla håll: då ska verktyget avstå.
    expect(fit.confident).toBe(false);
  });
});

describe("rotationen som three.js faktiskt utför", () => {
  /*
   * Testet räknar på matrisen, inte på måtten. Måttpermutationen kan vara
   * riktig medan uppritningen är fel — det var precis vad som hände: med
   * three.js standardordning XYZ blir matrisen Rx·Ry, alltså vridning före
   * upprätning, och maskinen ställde sig på högkant. Med noll vridning märks
   * det inte, så bara ett test som vrider kan fånga det.
   *
   * Efter konverteringen ligger en Y-upp-källa så här i glTF:
   *   maskinens upp    → +Z
   *   maskinens längd  → +Y
   *   maskinens bredd  → +X
   * och målet är three.js egna: upp +Y, längd +X, bredd +Z.
   */
  const apply = (orientation: Parameters<typeof orientationEuler>[0], axis: Vector3) => {
    const e = orientationEuler(orientation);
    const m = new Matrix4().makeRotationFromEuler(new Euler(e.x, e.y, 0, e.order));
    return axis.clone().applyMatrix4(m);
  };
  const near = (v: Vector3, x: number, y: number, z: number) => {
    expect(v.x).toBeCloseTo(x, 5);
    expect(v.y).toBeCloseTo(y, 5);
    expect(v.z).toBeCloseTo(z, 5);
  };

  it("reser en Y-upp-modell utan att vrida den", () => {
    const o = { upAxis: "y", yawDeg: 0 } as const;
    near(apply(o, new Vector3(0, 0, 1)), 0, 1, 0); // upp hamnar rätt
    near(apply(o, new Vector3(0, 1, 0)), 0, 0, -1); // längden ligger tvärs
  });

  it("lägger längden längs flödet vid det valda kvartsvarvet", () => {
    const o = { upAxis: "y", yawDeg: 270 } as const;
    near(apply(o, new Vector3(0, 0, 1)), 0, 1, 0); // upp är fortfarande upp
    near(apply(o, new Vector3(0, 1, 0)), 1, 0, 0); // längden längs +X
    near(apply(o, new Vector3(1, 0, 0)), 0, 0, 1); // bredden tvärs
  });

  it("håller uppriktningen lodrät vid varje vridning", () => {
    // Det här är felet, formulerat: vrider man kring fel axel lägger sig
    // maskinen ner. Upp ska vara upp oavsett hur mycket den vrids.
    for (const yawDeg of YAW_STEPS) {
      near(apply({ upAxis: "y", yawDeg }, new Vector3(0, 0, 1)), 0, 1, 0);
      near(apply({ upAxis: "z", yawDeg }, new Vector3(0, 1, 0)), 0, 1, 0);
    }
  });

  it("låter en Z-upp-modell vara orörd", () => {
    const o = { upAxis: "z", yawDeg: 0 } as const;
    near(apply(o, new Vector3(1, 0, 0)), 1, 0, 0);
    near(apply(o, new Vector3(0, 1, 0)), 0, 1, 0);
  });
});
