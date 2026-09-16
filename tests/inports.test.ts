import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { pickInPort, solveLayout } from "@/lib/solver";
import { inPortOf, usedInPorts } from "@/lib/branches";
import { BUILTIN_MACHINES, makeLibrary } from "@/lib/library";
import { defaultConfig } from "@/lib/templates";
import type { Configuration, LineItem, Machine } from "@/lib/types";

/**
 * Vald ingång styr hur maskinen vrids.
 *
 * Utgången har alltid varit ett val per maskin — samma rullbana går rakt i
 * ett flöde och vinklar i ett annat. Ingången var hårdkodad till den första,
 * så att peka ut en annan ändrade ingenting: maskinen låg kvar i fel
 * riktning. Ingången är nu symmetrisk med utgången.
 */

const rullbana = BUILTIN_MACHINES.find((m) => m.id === "rullbana")!;
const mall = rullbana.ports[0];

/** Kortsidan rakt igenom, plus en ingång på långsidan. */
const banaMedSidoingång: Machine = {
  ...rullbana,
  id: "bana-2in",
  name: "Rullbana med sidoingång",
  footprint: { lengthMm: 6000, widthMm: 2000, heightMm: 600 },
  ports: [
    { ...mall, id: "in", role: "in", pos: { x: 0, y: 1000 }, dir: "x+" },
    { ...mall, id: "in2", name: "Långsidan", role: "in", pos: { x: 3000, y: 2000 }, dir: "y-" },
    { ...mall, id: "ut", role: "out", pos: { x: 6000, y: 1000 }, dir: "x+" },
  ],
  variants: undefined,
  parametricLength: undefined,
  requires: undefined,
  conflictsWith: undefined,
};

const library = makeLibrary([...BUILTIN_MACHINES, banaMedSidoingång]);

let n = 0;
const item = (machineId: string, extra: Partial<LineItem> = {}): LineItem => {
  n += 1;
  return { instanceId: `${machineId}-${n}`, machineId, selectedOptions: [], ...extra };
};

function medIngång(inPortId?: string) {
  const först = item("rullbana");
  const bana = item("bana-2in", inPortId ? { inPortId } : {});
  const config: Configuration = { ...defaultConfig(), line: [först, bana] };
  const solved = solveLayout(config, library);
  return {
    config,
    bana,
    först,
    at: (id: string) => solved.placements.find((p) => p.instanceId === id)!,
    solved,
  };
}

describe("vald ingång vrider maskinen", () => {
  it("vänder den valda ingången mot flödet, inte den första", () => {
    const { bana, at } = medIngång("in2");
    const placering = at(bana.instanceId);
    const vald = placering.ports.find((p) => p.id === "in2")!;
    const föregående = at("rullbana-1");
    const ut = föregående.ports.find((p) => p.role === "out")!;

    // Ingången ska ligga i den föregående maskinens utgång och peka åt samma håll.
    expect(vald.pos).toEqual(ut.pos);
    expect(vald.dir).toBe(ut.dir);
  });

  it("ger en annan rotation än när första ingången används", () => {
    // Själva felet: att peka ut en annan ingång ändrade ingenting.
    const utan = medIngång();
    const med = medIngång("in2");
    expect(med.at(med.bana.instanceId).rotation).not.toBe(
      utan.at(utan.bana.instanceId).rotation,
    );
  });

  it("låter maskinen stå tvärs när den matas på långsidan", () => {
    // Går flödet in på långsidan måste banan stå vinkelrätt mot den som matar.
    const { bana, at } = medIngång("in2");
    const bredd = at(bana.instanceId).bbox;
    // 6 m lång och 2 m bred: står den tvärs är boxen högre än den är bred.
    expect(bredd.w).toBeGreaterThan(bredd.l);
  });

  it("räknar den valda ingången som upptagen, inte den första", () => {
    const { config, bana } = medIngång("in2");
    const upptagna = usedInPorts(config.line, bana.instanceId, banaMedSidoingång);
    expect(upptagna.has("in2")).toBe(true);
    expect(upptagna.has("in")).toBe(false);
  });

  it("anmärker inte på glapp när en annan ingång valts", () => {
    const { config, bana } = medIngång("in2");
    const glapp = computeLayout(config, library)
      .diagnostics.filter((d) => d.code === "R-101")
      .flatMap((d) => d.instanceIds ?? []);
    expect(glapp).not.toContain(bana.instanceId);
  });

  it("faller tillbaka på första ingången när valet pekar på en port som inte finns", () => {
    const { bana, at } = medIngång("finns-inte");
    const utan = medIngång();
    expect(at(bana.instanceId).rotation).toBe(utan.at(utan.bana.instanceId).rotation);
  });
});

describe("pickInPort", () => {
  it("tar första ingången utan val", () => {
    expect(pickInPort(banaMedSidoingång.ports)?.id).toBe("in");
  });

  it("tar den utpekade ingången", () => {
    expect(pickInPort(banaMedSidoingång.ports, "in2")?.id).toBe("in2");
  });

  it("struntar i ett id som är en utgång", () => {
    expect(pickInPort(banaMedSidoingång.ports, "ut")?.id).toBe("in");
  });
});

describe("inPortOf", () => {
  it("ger maskinens första ingång utan val", () => {
    expect(inPortOf(item("bana-2in"), banaMedSidoingång)).toBe("in");
  });

  it("ger den valda", () => {
    expect(inPortOf(item("bana-2in", { inPortId: "in2" }), banaMedSidoingång)).toBe("in2");
  });
});

/** Samma sak mot den riktiga katalogen — det är den kunden klickar i. */
describe("sidoingången i den riktiga katalogen", () => {
  const SEED = path.join(process.cwd(), "data", "library.json");

  it.runIf(existsSync(SEED))("vrider rullbanan när långsidan väljs", () => {
    const document = JSON.parse(readFileSync(SEED, "utf-8"));
    const seedLibrary = makeLibrary(document.machines as Machine[]);

    const bygg = (inPortId?: string) => {
      const först = item("tsl-enkel");
      const bana = item("rullbana", inPortId ? { inPortId } : {});
      const config: Configuration = { ...defaultConfig(), line: [först, bana] };
      const solved = solveLayout(config, seedLibrary);
      expect(solved.unplaced).toEqual([]);
      expect(solved.placements.filter((p) => !p.aux)).toHaveLength(2);
      return { bana, först, solved };
    };

    const rakt = bygg();
    const tvärs = bygg("in2");
    const at = (s: ReturnType<typeof bygg>, id: string) =>
      s.solved.placements.find((p) => p.instanceId === id)!;

    expect(at(tvärs, tvärs.bana.instanceId).rotation).not.toBe(
      at(rakt, rakt.bana.instanceId).rotation,
    );

    // Och skarven sitter ihop: sidoingången ligger i föregångarens utgång.
    const ingång = at(tvärs, tvärs.bana.instanceId).ports.find((p) => p.id === "in2")!;
    const utgång = at(tvärs, tvärs.först.instanceId).ports.find((p) => p.role === "out")!;
    expect(ingång.pos).toEqual(utgång.pos);
  });
});

/**
 * Två linjer i samma ingång.
 *
 * Gränssnittet gråar ut en ingång som redan matas, men en delad länk kan
 * innehålla vad som helst. Regeln fångar det som klicket hindrar.
 */
describe("dubbelbokad ingång", () => {
  const koden = (config: Configuration) =>
    computeLayout(config, library).diagnostics.filter((d) => d.code === "R-209");

  it("anmärker när huvudflödet och en matarlinje tar samma ingång", () => {
    const först = item("rullbana");
    const bana = item("bana-2in", { inPortId: "in2" });
    const matare = item("rullbana", {
      feeds: { toInstanceId: bana.instanceId, inPortId: "in2" },
    });
    const config: Configuration = { ...defaultConfig(), line: [först, bana, matare] };

    const funna = koden(config);
    expect(funna).toHaveLength(1);
    expect(funna[0].severity).toBe("error");
    expect(funna[0].instanceIds).toContain(bana.instanceId);
  });

  it("tiger när de tar var sin ingång", () => {
    const först = item("rullbana");
    const bana = item("bana-2in"); // huvudflödet i "in"
    const matare = item("rullbana", {
      feeds: { toInstanceId: bana.instanceId, inPortId: "in2" },
    });
    const config: Configuration = { ...defaultConfig(), line: [först, bana, matare] };
    expect(koden(config)).toHaveLength(0);
  });

  it("tiger för en vanlig rak linje", () => {
    const config: Configuration = {
      ...defaultConfig(),
      line: [item("rullbana"), item("kedjetransportor"), item("bandomforing")],
    };
    expect(koden(config)).toHaveLength(0);
  });
});
