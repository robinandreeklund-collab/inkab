import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { solveLayout } from "@/lib/solver";
import { connectedPairs, removeWithBranches, segmentEndIndex, segments, usedOutPorts } from "@/lib/branches";
import { BUILTIN_MACHINES, makeLibrary } from "@/lib/library";
import { configurationSchema } from "@/lib/schema";
import { templateConfig } from "@/lib/templates";
import type { Configuration, Machine } from "@/lib/types";

/**
 * Grenar: maskiner på flera utgångar.
 *
 * Linjen är ett träd lagrat som en platt lista. En post med `branch` startar
 * en gren på en tidigare maskins utgång, och allt som följer hör till samma
 * gren tills nästa grenrot.
 */

const base = BUILTIN_MACHINES.find((m) => m.id === "rullbana-underslag")!;

const splitter: Machine = {
  ...base,
  id: "delare",
  model: { glb: "/x" },
  footprint: { lengthMm: 6000, widthMm: 2000, heightMm: 800 },
  ports: [
    { ...base.ports[0], id: "in", role: "in", pos: { x: 0, y: 1000 }, dir: "x+" },
    { ...base.ports[1], id: "fram", name: "Rakt fram", role: "out", pos: { x: 6000, y: 1000 }, dir: "x+" },
    {
      ...base.ports[1],
      id: "sida",
      name: "Ut på kortsidan",
      role: "out",
      pos: { x: 3000, y: 2000 },
      dir: "y+",
      allowsDirectionChange: true,
    },
  ],
};

const library = makeLibrary([...BUILTIN_MACHINES, splitter]);

const config = (line: Configuration["line"]): Configuration => ({
  ...templateConfig("strolinje"),
  line,
});

const item = (instanceId: string, machineId: string, extra: object = {}) => ({
  instanceId,
  machineId,
  selectedOptions: [],
  ...extra,
});

describe("två grenar ur samma maskin", () => {
  const both = config([
    item("a", "delare"),
    item("b", base.id),
    item("c", base.id, { branch: { fromInstanceId: "a", outPortId: "sida" } }),
    item("d", base.id),
  ]);

  it("placerar alla fyra maskinerna", () => {
    const solved = solveLayout(both, library);
    expect(solved.placements.filter((p) => !p.aux)).toHaveLength(4);
    expect(solved.unplaced).toHaveLength(0);
  });

  it("lägger huvudlinjen rakt fram och grenen åt sidan", () => {
    const layout = computeLayout(both, library);
    const at = (id: string) => layout.placements.find((p) => p.instanceId === id)!;

    // b fortsätter rakt fram ur a: längre bort i x, och i samma flöde tvärs.
    expect(at("b").bbox.x).toBeGreaterThan(at("a").bbox.x);
    const aMid = at("a").bbox.y + at("a").bbox.w / 2;
    expect(Math.abs(at("b").bbox.y + at("b").bbox.w / 2 - aMid)).toBeLessThan(50);

    // c hänger på sidoutgången och ligger bredvid, inte i förlängningen.
    expect(at("c").bbox.y).toBeGreaterThan(at("a").bbox.y + at("a").bbox.w - 1);
  });

  it("fortsätter grenen med maskinen efter grenroten", () => {
    const layout = computeLayout(both, library);
    const c = layout.placements.find((p) => p.instanceId === "c")!;
    const d = layout.placements.find((p) => p.instanceId === "d")!;
    // d hänger på c, alltså längre bort i grenens riktning.
    expect(d.bbox.y).toBeGreaterThan(c.bbox.y);
  });

  it("låter grenen gå fri från huvudlinjen", () => {
    const layout = computeLayout(both, library);
    const boxes = layout.placements.filter((p) => !p.aux).map((p) => p.bbox);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap =
          a.x < b.x + b.l - 30 && b.x < a.x + a.l - 30 &&
          a.y < b.y + b.w - 30 && b.y < a.y + a.w - 30;
        expect(overlap, `maskin ${i} och ${j} överlappar`).toBe(false);
      }
    }
  });
});

describe("grenar som inte går ihop", () => {
  it("säger till när grenen utgår från en maskin som kommer senare", () => {
    const solved = solveLayout(
      config([
        item("a", "delare"),
        item("c", base.id, { branch: { fromInstanceId: "z", outPortId: "sida" } }),
      ]),
      library,
    );
    expect(solved.unplaced[0].reason).toMatch(/ligger inte före/);
  });

  it("säger till när utgången inte finns", () => {
    const solved = solveLayout(
      config([
        item("a", "delare"),
        item("c", base.id, { branch: { fromInstanceId: "a", outPortId: "finns-inte" } }),
      ]),
      library,
    );
    expect(solved.unplaced[0].reason).toMatch(/finns inte på maskinen/);
  });
});

describe("bakåtkompatibelt", () => {
  it("en linje utan grenar ser likadan ut som förut", () => {
    const plain = config([item("a", "delare"), item("b", base.id), item("c", base.id)]);
    const solved = solveLayout(plain, library);
    const xs = solved.placements.filter((p) => !p.aux).map((p) => p.bbox.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(solved.unplaced).toHaveLength(0);
  });

  it("schemat godkänner grenlänkar", () => {
    const parsed = configurationSchema.safeParse(
      config([item("a", "delare"), item("c", base.id, { branch: { fromInstanceId: "a", outPortId: "sida" } })]),
    );
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

describe("linjen som träd", () => {
  const line = [
    item("a", "delare"),
    item("b", base.id),
    item("c", base.id, { branch: { fromInstanceId: "a", outPortId: "sida" } }),
    item("d", base.id),
  ] as never as import("@/lib/types").LineItem[];

  it("delar upp i huvudlinje och gren", () => {
    const parts = segments(line);
    expect(parts).toHaveLength(2);
    expect(parts[0].branch).toBeNull();
    expect(parts[0].items.map((i) => i.instanceId)).toEqual(["a", "b"]);
    expect(parts[1].branch).toEqual({ fromInstanceId: "a", outPortId: "sida" });
    expect(parts[1].items.map((i) => i.instanceId)).toEqual(["c", "d"]);
  });

  it("lägger en ny maskin sist i samma gren", () => {
    // Väljer man en maskin i grenen ska nästa hamna där, inte sist i listan.
    expect(segmentEndIndex(line, "c")).toBe(4);
    expect(segmentEndIndex(line, "b")).toBe(2);
    expect(segmentEndIndex(line, null)).toBe(4);
  });

  it("tar bort grenen när dess rot tas bort", () => {
    // En gren utan fäste går inte att placera; att lämna kvar den vore att
    // lämna maskiner som varken kan ritas eller hittas.
    const kept = removeWithBranches(line, "a");
    expect(kept.map((i) => i.instanceId)).toEqual(["b"]);
  });

  it("tar bort grenar som hänger på grenar", () => {
    const deep = [
      ...line,
      item("e", base.id, { branch: { fromInstanceId: "d", outPortId: "sida" } }),
    ] as never as import("@/lib/types").LineItem[];
    expect(removeWithBranches(deep, "a").map((i) => i.instanceId)).toEqual(["b"]);
  });

  it("släpper länken när en gren blir huvudlinje", () => {
    const kept = removeWithBranches(line, "b");
    const first = removeWithBranches(kept, "a")[0];
    expect(first?.branch).toBeUndefined();
  });

  it("vet vilka utgångar som är upptagna", () => {
    const machine = splitter;
    const used = usedOutPorts(line, "a", machine);
    // "fram" av fortsättningen i huvudlinjen, "sida" av grenen.
    expect([...used].sort()).toEqual(["fram", "sida"]);

    // Sista maskinen i en gren har inget kopplat.
    expect(usedOutPorts(line, "d", machine).size).toBe(0);
  });
});

describe("reglerna förstår trädet", () => {
  it("klagar inte på maskinzonen mellan en gren och dess fäste", () => {
    /*
     * Grenroten är inkopplad port mot port på sin förälder och står med rätta
     * i dess frigång. Regeln räknade tidigare på positionsnummer, vilket höll
     * så länge linjen var en rak kedja — en grenrot kan ha nummer 3 och sitta
     * på nummer 1.
     */
    const layout = computeLayout(
      config([
        item("a", "delare"),
        item("b", base.id),
        item("c", base.id, { branch: { fromInstanceId: "a", outPortId: "sida" } }),
      ]),
      library,
    );
    const zonfel = layout.diagnostics.filter(
      (d) => d.code === "R-106" && d.instanceIds.includes("c") && d.instanceIds.includes("a"),
    );
    expect(zonfel).toHaveLength(0);
  });

  it("kopplar ihop rätt par", () => {
    const line = [
      item("a", "delare"),
      item("b", base.id),
      item("c", base.id, { branch: { fromInstanceId: "a", outPortId: "sida" } }),
      item("d", base.id),
    ] as never as import("@/lib/types").LineItem[];
    const pairs = connectedPairs(line);
    expect(pairs.has("a|b")).toBe(true);
    expect(pairs.has("a|c")).toBe(true);
    expect(pairs.has("c|d")).toBe(true);
    // b och c hänger inte ihop, trots att de ligger efter varandra i listan.
    expect(pairs.has("b|c")).toBe(false);
  });
});
