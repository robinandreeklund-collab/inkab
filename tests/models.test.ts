import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { convertStep, suggestPorts } from "@/lib/cad/stepConvert";
import { deleteModel, listModels, putModel, readModel } from "@/lib/server/store";
import { applyModelFootprint, applySuggestedPorts } from "@/lib/cad/applyModel";
import { addYaw, flowFromPicks, snapToEdge } from "@/lib/cad/pickFlow";
import { collectIssues, machineSchema } from "@/lib/machineSchema";
import { Euler, Matrix4, Vector3 } from "three";
import {
  bestOrientation,
  DEFAULT_ORIENTATION,
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

  it("håller portarna innanför ett mindre fotavtryck", () => {
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

  it("skalar portarna med måtten i stället för att klippa dem", () => {
    // Samma maskin, uppmätt i stället för uppskattad: en port mitt på ska
    // sitta mitt på även efteråt, och utporten kvar i änden.
    const doubled = {
      lengthMm: machine.footprint.lengthMm * 2,
      widthMm: machine.footprint.widthMm * 2,
      heightMm: machine.footprint.heightMm,
    };
    const { machine: applied } = applyModelFootprint(machine, doubled);

    for (const [i, port] of applied.ports.entries()) {
      expect(port.pos.x).toBe(machine.ports[i].pos.x * 2);
      expect(port.pos.y).toBe(machine.ports[i].pos.y * 2);
    }
    const out = applied.ports.find((p) => p.role === "out")!;
    expect(out.pos.x).toBe(doubled.lengthMm);
    expect(machineSchema.safeParse(applied).success).toBe(true);
  });

  it("rör inga portar när måtten är oförändrade", () => {
    const { machine: applied, movedPorts } = applyModelFootprint(machine, machine.footprint);
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

describe("riktningen är CAD-systemets, inte maskinens", () => {
  /*
   * Två verkliga filer ur samma CAD, uppmätta ur STEP:
   *
   *   Rullbana   X=1,57  Y=0,60  Z=3,00   en tre meter lång bana
   *   Lättpress  X=2,44  Y=1,83  Z=0,18   en portal som trycker från sidan
   *
   * De ser inget lika ut, men delar konvention: X tvärs, Y upp, Z i flödet.
   * Samma riktning ska alltså göra båda rätt — och det gör bibliotekets
   * standardriktning, till skillnad från en gissning ur uppskattade mått.
   */
  const rullbana = { lengthMm: 1570, widthMm: 600, heightMm: 3000 };
  const lattpress = { lengthMm: 2440, widthMm: 1832, heightMm: 180 };

  it("ger rätt mått åt båda med bibliotekets standardriktning", () => {
    expect(orientedFootprint(rullbana, DEFAULT_ORIENTATION)).toEqual({
      lengthMm: 3000,
      widthMm: 1570,
      heightMm: 600,
    });
    expect(orientedFootprint(lattpress, DEFAULT_ORIENTATION)).toEqual({
      // Pressen är grund i flödesriktningen och bred tvärs — den trycker
      // ihop paketet från sidan.
      lengthMm: 180,
      widthMm: 2440,
      heightMm: 1832,
    });
  });

  it("visar varför gissningen ur uppskattade mått inte höll", () => {
    // Rullbanan råkade bli rätt, lättpressen fel. Ett verktyg som har rätt
    // ibland är inte ett verktyg man kan lita på.
    const gissadRullbana = bestOrientation(rullbana, { lengthMm: 6000, widthMm: 1800, heightMm: 700 });
    const gissadPress = bestOrientation(lattpress, { lengthMm: 2600, widthMm: 3400, heightMm: 2600 });

    expect(gissadRullbana.orientation).toEqual(DEFAULT_ORIENTATION);
    expect(gissadPress.orientation).not.toEqual(DEFAULT_ORIENTATION);
  });

  it("står upprätt i uppritningen för båda", () => {
    // Upp ska vara upp oavsett vilken av maskinerna det gäller.
    const e = orientationEuler(DEFAULT_ORIENTATION);
    const m = new Matrix4().makeRotationFromEuler(new Euler(e.x, e.y, 0, e.order));
    const up = new Vector3(0, 0, 1).applyMatrix4(m);
    expect(up.y).toBeCloseTo(1, 5);
    // Och flödet, som ligger på glTF:ens Y efter konverteringen, hamnar på X.
    const flow = new Vector3(0, 1, 0).applyMatrix4(m);
    expect(flow.x).toBeCloseTo(1, 5);
  });
});

describe("peka ut flödet på modellen", () => {
  const footprint = { lengthMm: 3000, widthMm: 1600 };

  /** Vridningen som uppritningen faktiskt gör, för att kontrollera tabellen. */
  const rotatePlan = (p: { x: number; y: number }, yawDeg: 0 | 90 | 180 | 270, f = footprint) => {
    const e = orientationEuler({ yawDeg });
    const m = new Matrix4().makeRotationFromEuler(new Euler(e.x, e.y, 0, e.order));
    // Maskinkoordinater → three.js, kring maskinens mitt: x längs längden,
    // z tvärs, båda med noll i centrum.
    const v = new Vector3(p.x - f.lengthMm / 2, 0, p.y - f.widthMm / 2).applyMatrix4(m);
    const turned = yawDeg === 90 || yawDeg === 270;
    const width = turned ? f.lengthMm : f.widthMm;
    const length = turned ? f.widthMm : f.lengthMm;
    return { x: Math.round(v.x + length / 2), y: Math.round(v.z + width / 2) };
  };

  it("låter en maskin som redan pekar rätt vara", () => {
    const pick = flowFromPicks({ x: 0, y: 800 }, { x: 3000, y: 800 }, footprint);
    expect(pick.yawDelta).toBe(0);
    expect(pick.swapsFootprint).toBe(false);
    expect(pick.outPos).toEqual({ x: 3000, y: 800 });
  });

  it("vänder en bakvänd maskin ett halvt varv", () => {
    const pick = flowFromPicks({ x: 3000, y: 500 }, { x: 0, y: 500 }, footprint);
    expect(pick.yawDelta).toBe(180);
    // Inporten hamnar i den nya framkanten.
    expect(pick.inPos).toEqual({ x: 0, y: 1100 });
    expect(pick.outPos).toEqual({ x: 3000, y: 1100 });
  });

  it("vrider ett kvarts varv när flödet går tvärs, och byter mått", () => {
    const pick = flowFromPicks({ x: 1500, y: 0 }, { x: 1500, y: 1600 }, footprint);
    expect(pick.yawDelta).toBe(90);
    expect(pick.swapsFootprint).toBe(true);
    expect(pick.footprint).toEqual({ lengthMm: 1600, widthMm: 3000 });
    expect(pick.inPos.x).toBe(0);
    expect(pick.outPos.x).toBe(1600);
  });

  it("vrider åt andra hållet när flödet går motsatt tvärs", () => {
    const pick = flowFromPicks({ x: 1500, y: 1600 }, { x: 1500, y: 0 }, footprint);
    expect(pick.yawDelta).toBe(270);
    expect(pick.inPos.x).toBe(0);
    expect(pick.outPos.x).toBe(1600);
  });

  it("stämmer med rotationen uppritningen gör", () => {
    /*
     * Tabellen i flowFromPicks är härledd för hand. Testet räknar samma sak
     * genom den riktiga rotationsmatrisen och kräver att de ger samma svar —
     * annars är det bara en tabell någon trodde stämde.
     */
    for (const [inP, outP] of [
      [{ x: 3000, y: 500 }, { x: 0, y: 500 }],
      [{ x: 1500, y: 0 }, { x: 1500, y: 1600 }],
      [{ x: 1500, y: 1600 }, { x: 1500, y: 0 }],
    ] as const) {
      const pick = flowFromPicks(inP, outP, footprint);
      expect(rotatePlan(inP, pick.yawDelta)).toEqual(pick.inPos);
      expect(rotatePlan(outP, pick.yawDelta)).toEqual(pick.outPos);
    }
  });

  it("räknar vridningen inom ett varv", () => {
    expect(addYaw(270, 180)).toBe(90);
    expect(addYaw(undefined, 90)).toBe(90);
    expect(addYaw(180, 180)).toBe(0);
  });

  it("drar porten ut till kortsidan", () => {
    const f = { lengthMm: 1600, widthMm: 3000 };
    expect(snapToEdge({ x: 700, y: 1400 }, f, "in")).toEqual({ x: 0, y: 1400 });
    expect(snapToEdge({ x: 700, y: 1400 }, f, "out")).toEqual({ x: 1600, y: 1400 });
  });
});
