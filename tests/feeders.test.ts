import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { solveLayout } from "@/lib/solver";
import { connectedPairs, segments, usedInPorts } from "@/lib/branches";
import { BUILTIN_MACHINES, makeLibrary } from "@/lib/library";
import { configurationSchema } from "@/lib/schema";
import { defaultConfig } from "@/lib/templates";
import type { Configuration, LineItem, Machine } from "@/lib/types";

/**
 * Matarlinjer: två inmatningar mot en gemensam bana.
 *
 * Det här var det som inte gick. Två transportörer kan inte sluta i samma
 * ingång, och en anläggning där de möts finns inte i en modell där varje
 * maskin har en föregångare. Lösningen ligger i katalogen, inte i geometrin:
 * banan har två ingångar, och en matarlinje slutar i var sin.
 */

const rullbana = BUILTIN_MACHINES.find((m) => m.id === "rullbana")!;
const port = rullbana.ports[0];

/** En rullbana med en sidoingång på långsidan — som INKAB:s kedjekanaler. */
const banaMedTvåIngångar: Machine = {
  ...rullbana,
  id: "bana-2in",
  name: "Rullbana med två ingångar",
  footprint: { lengthMm: 12000, widthMm: 2000, heightMm: 600 },
  ports: [
    { ...port, id: "in", role: "in", pos: { x: 0, y: 1000 }, dir: "x+" },
    {
      ...port,
      id: "in2",
      name: "Sidoingång",
      role: "in",
      pos: { x: 6000, y: 2000 },
      dir: "y-",
      allowsDirectionChange: true,
    },
    { ...port, id: "ut", role: "out", pos: { x: 12000, y: 1000 }, dir: "x+" },
  ],
  variants: undefined,
  parametricLength: undefined,
  requires: undefined,
  conflictsWith: undefined,
};

const library = makeLibrary([...BUILTIN_MACHINES, banaMedTvåIngångar]);

let n = 0;
const item = (machineId: string, extra: Partial<LineItem> = {}): LineItem => {
  n += 1;
  return { instanceId: `${machineId}-${n}`, machineId, selectedOptions: [], ...extra };
};

/**
 * Huvudlinjen kommer in i banans kortsida. En matarlinje på två maskiner
 * slutar i sidoingången — det är den andra inporten på skissen.
 */
function medMatarlinje() {
  const bana = item("bana-2in");
  const matare1 = item("rullbana", { feeds: { toInstanceId: bana.instanceId, inPortId: "in2" } });
  const matare2 = item("kedjetransportor");
  const efter = item("bandomforing");

  const config: Configuration = {
    ...defaultConfig(),
    line: [bana, efter, matare1, matare2],
  };
  return { config, bana, matare1, matare2, efter };
}

describe("en matarlinje slutar i den ingång den matar", () => {
  const { config, bana, matare1, matare2 } = medMatarlinje();
  const solved = solveLayout(config, library);
  const at = (id: string) => solved.placements.find((p) => p.instanceId === id)!;

  it("placerar alla maskiner", () => {
    expect(solved.unplaced).toEqual([]);
    expect(solved.placements.filter((p) => !p.aux)).toHaveLength(4);
  });

  it("lägger matarlinjens sista maskin precis i sidoingången", () => {
    const sidoingång = at(bana.instanceId).ports.find((p) => p.id === "in2")!;
    // Matarlinjen står i flödesordning, så den sista är den som möter porten.
    const möter = at(matare2.instanceId).ports.find((p) => p.role === "out")!;

    expect(möter.pos).toEqual(sidoingång.pos);
    expect(möter.dir).toBe(sidoingång.dir);
  });

  it("bygger resten av matarlinjen uppströms, inte nedströms", () => {
    const sidoingång = at(bana.instanceId).ports.find((p) => p.id === "in2")!;
    // Flödet går in i porten åt −y, alltså ligger matarlinjen ovanför banan.
    expect(at(matare2.instanceId).bbox.y).toBeGreaterThan(at(bana.instanceId).bbox.y);
    expect(at(matare1.instanceId).bbox.y).toBeGreaterThanOrEqual(at(matare2.instanceId).bbox.y);
    expect(sidoingång.dir).toBe("y-");
  });

  it("lägger inte matarlinjen ovanpå huvudlinjen", () => {
    const banans = at(bana.instanceId).bbox;
    for (const id of [matare1.instanceId, matare2.instanceId]) {
      const box = at(id).bbox;
      const överlapp =
        box.x < banans.x + banans.l &&
        box.x + box.l > banans.x &&
        box.y < banans.y + banans.w &&
        box.y + box.w > banans.y;
      expect(överlapp).toBe(false);
    }
  });

  it("räknar matarlinjens sista maskin som inkopplad i banan", () => {
    const pairs = connectedPairs(config.line);
    const key = [bana.instanceId, matare2.instanceId].sort().join("|");
    expect(pairs.has(key)).toBe(true);
  });

  it("går igenom serverns schema", () => {
    expect(configurationSchema.safeParse(config).success).toBe(true);
  });

  it("anmärker inte på glapp i skarven mot sidoingången", () => {
    // R-101 jämförde förut grannar i listan. Matarlinjen ligger sist men
    // mynnar mitt i linjen, så den skarven såg ut som ett glapp på tolv meter.
    const glapp = computeLayout(config, library).diagnostics.filter((d) => d.code === "R-101");
    const inblandade = glapp.flatMap((d) => d.instanceIds ?? []);
    expect(inblandade).not.toContain(matare2.instanceId);
    expect(inblandade).not.toContain(bana.instanceId);
  });
});

describe("två matarlinjer mot samma bana", () => {
  it("möts i var sin ingång utan att krocka", () => {
    const bana = item("bana-2in");
    const via1 = item("rullbana", { feeds: { toInstanceId: bana.instanceId, inPortId: "in" } });
    const via2 = item("rullbana", { feeds: { toInstanceId: bana.instanceId, inPortId: "in2" } });

    const config: Configuration = { ...defaultConfig(), line: [bana, via1, via2] };
    const solved = solveLayout(config, library);
    const at = (id: string) => solved.placements.find((p) => p.instanceId === id)!;

    expect(solved.unplaced).toEqual([]);

    const in1 = at(bana.instanceId).ports.find((p) => p.id === "in")!;
    const in2 = at(bana.instanceId).ports.find((p) => p.id === "in2")!;
    expect(at(via1.instanceId).ports.find((p) => p.role === "out")!.pos).toEqual(in1.pos);
    expect(at(via2.instanceId).ports.find((p) => p.role === "out")!.pos).toEqual(in2.pos);

    // De två matarlinjerna kommer från olika håll och står inte på varandra.
    expect(at(via1.instanceId).bbox).not.toEqual(at(via2.instanceId).bbox);
  });
});

describe("bokföringen av ingångar", () => {
  it("vet vilken ingång som är upptagen och vilken som är ledig", () => {
    const { config, bana } = medMatarlinje();
    const upptagna = usedInPorts(config.line, bana.instanceId, banaMedTvåIngångar);

    // Sidoingången är tagen av matarlinjen; huvudingången är ledig eftersom
    // banan är först i linjen och inget står före den.
    expect(upptagna.has("in2")).toBe(true);
    expect(upptagna.has("in")).toBe(false);
  });

  it("delar listan i huvudlinje och matarlinje", () => {
    const { config } = medMatarlinje();
    const delar = segments(config.line);
    expect(delar).toHaveLength(2);
    expect(delar[0].feeds).toBeNull();
    expect(delar[1].feeds?.inPortId).toBe("in2");
    expect(delar[1].items).toHaveLength(2);
  });
});

describe("kapaciteten i mötet", () => {
  it("varnar när två linjer lämnar mer än banan klarar", () => {
    // Banan tar 30 paket/h. Två kedjetransportörer lämnar 32 var.
    const bana = item("bana-2in");
    const via1 = item("kedjetransportor", { feeds: { toInstanceId: bana.instanceId, inPortId: "in" } });
    const via2 = item("kedjetransportor", { feeds: { toInstanceId: bana.instanceId, inPortId: "in2" } });

    const config: Configuration = { ...defaultConfig(), line: [bana, via1, via2] };
    const möte = computeLayout(config, library).diagnostics.find((d) => d.code === "R-208");

    expect(möte?.title).toContain("tar emot mer än den klarar");
    expect(möte?.detail).toMatch(/2 linjer lämnar tillsammans 64 paket\/h/);
  });

  it("tiger när banan klarar summan", () => {
    const bana = item("bana-2in");
    const via1 = item("rullbana", { feeds: { toInstanceId: bana.instanceId, inPortId: "in2" } });

    const config: Configuration = { ...defaultConfig(), line: [bana, via1] };
    expect(
      computeLayout(config, library).diagnostics.some((d) => d.code === "R-208"),
    ).toBe(false);
  });
});

/**
 * Samma sak mot den riktiga katalogen.
 *
 * Testerna ovan bygger sin egen maskin, så de bevisar att motorn klarar
 * matarlinjer — inte att demon gör det. Rullbanan i `data/library.json` har
 * fått en sidoingång, och det är den kunden faktiskt klickar på.
 */
describe("två inmatningar mot rullbanan i den riktiga katalogen", () => {
  const SEED = path.join(process.cwd(), "data", "library.json");

  it.runIf(existsSync(SEED))("möts i banan, var och en i sin ingång", () => {
    const document = JSON.parse(readFileSync(SEED, "utf-8"));
    const seedLibrary = makeLibrary(document.machines as Machine[]);
    const bana = seedLibrary.machines.find((m) => m.id === "rullbana")!;
    expect(bana.ports.filter((p) => p.role === "in")).toHaveLength(2);

    // Inmatning 1 går in i kortsidan som vanligt; inmatning 2 är matarlinjen.
    const mottagare = item("rullbana");
    const inmatning1 = item("tsl-enkel");
    const inmatning2 = item("tsl-enkel", {
      feeds: { toInstanceId: mottagare.instanceId, inPortId: "in2" },
    });

    const config: Configuration = {
      ...defaultConfig(),
      line: [inmatning1, mottagare, inmatning2],
    };
    const solved = solveLayout(config, seedLibrary);
    expect(solved.unplaced).toEqual([]);
    // Okända maskin-id:n tappas tyst, så räkna dem — annars provar testet inget.
    expect(solved.placements.filter((p) => !p.aux)).toHaveLength(3);

    const at = (id: string) => solved.placements.find((p) => p.instanceId === id)!;
    const sidoingång = at(mottagare.instanceId).ports.find((p) => p.id === "in2")!;
    expect(at(inmatning2.instanceId).ports.find((p) => p.role === "out")!.pos).toEqual(
      sidoingång.pos,
    );

    // De två inmatningarna kommer från olika håll och står inte på varandra.
    expect(at(inmatning1.instanceId).bbox).not.toEqual(at(inmatning2.instanceId).bbox);

    // Och skarven räknas som en koppling, inte som ett glapp.
    const glapp = computeLayout(config, seedLibrary)
      .diagnostics.filter((d) => d.code === "R-101")
      .flatMap((d) => d.instanceIds ?? []);
    expect(glapp).not.toContain(inmatning2.instanceId);
  });
});
