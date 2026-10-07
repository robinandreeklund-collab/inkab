import { describe, expect, it } from "vitest";
import { computeLayout } from "@/lib/layout";
import { lineItem, templateConfig, defaultConfig } from "@/lib/templates";
import { BUILTIN_LIBRARY, makeLibrary, type MachineLibrary } from "@/lib/library";
import catalogue from "../data/library.json";
import { findConnections } from "@/lib/connections";
import type { Configuration, Machine, Rotation } from "@/lib/types";

/** Den riktiga katalogen, som den körs live — med rullbanans sidoingång. */
const REAL: MachineLibrary = makeLibrary((catalogue as unknown as { machines: Machine[] }).machines);

/**
 * Varningarna med fri placering.
 *
 * Regelverket läser ur portarna vilka maskiner som för paket mellan sig. En
 * överföring i ett hörn är då inget intrång, medan en maskin som står lös eller
 * är vänd åt fel håll får en varning — det gav regelverket inte förut.
 */

const layoutOf = (c: Configuration, lib: MachineLibrary = BUILTIN_LIBRARY) => computeLayout(c, lib);
const codes = (c: Configuration, lib?: MachineLibrary) => layoutOf(c, lib).diagnostics.map((d) => d.code);

describe("kopplingar ur portarna", () => {
  it("en vanlig linje hänger ihop från början till slut", () => {
    const layout = layoutOf(templateConfig("strolinje"));
    const { connections, mismatches } = findConnections(layout.placements);
    const chain = layout.placements.filter((p) => !p.aux);
    expect(connections).toHaveLength(chain.length - 1);
    expect(mismatches).toHaveLength(0);
  });

  it("mallarna ger varken R-601 eller R-602, med båda katalogerna", () => {
    for (const lib of [BUILTIN_LIBRARY, REAL]) {
      for (const id of ["strolinje", "multilinje", "underslag", "komplett"]) {
        const found = codes(templateConfig(id, lib), lib);
        expect(found, id).not.toContain("R-601");
        expect(found, id).not.toContain("R-602");
      }
    }
  });
});

describe("R-602 maskin åt fel håll", () => {
  it("varnar när en maskin i linjen står vriden ett halvt varv", () => {
    const config = templateConfig("strolinje");
    const press = layoutOf(config).placements[2];
    // Ett halvt varv kring origo: samma ruta får origo i det motsatta hörnet.
    config.line[2].rotation = 180;
    config.line[2].pos = { x: press.bbox.x + press.bbox.l, y: press.bbox.y + press.bbox.w };
    const layout = layoutOf(config);
    expect(layout.placements[2].bbox).toEqual(press.bbox);
    expect(layout.diagnostics.map((d) => d.code)).toContain("R-602");
  });
});

describe("R-601 lös maskin", () => {
  it("varnar när en maskin ställs långt från resten", () => {
    const config = templateConfig("strolinje");
    config.line[4].pos = { x: 30000, y: 2000 };
    const loose = layoutOf(config).diagnostics.filter((d) => d.code === "R-601");
    expect(loose.map((d) => d.instanceIds[0])).toContain(config.line[4].instanceId);
  });

  it("tiger när det bara finns en maskin", () => {
    const config = defaultConfig();
    config.line = [lineItem("rullbana")];
    expect(codes(config)).not.toContain("R-601");
  });
});

describe("överföring i ett hörn", () => {
  it("en maskin som matar in i rullbanans sidoingång gör inget intrång", () => {
    const config = defaultConfig();
    const bana = lineItem("rullbana");
    bana.pos = { x: 10000, y: 8000 };
    const matare = lineItem("bandomforing");
    config.line = [matare, bana];

    const side = layoutOf(config, REAL).placements
      .find((p) => p.instanceId === bana.instanceId)!
      .ports.find((p) => p.id === "in2")!;

    // Vrid mataren så att dess utgång pekar åt samma håll som sidoingången,
    // och flytta den så att utgången hamnar precis vid ingången.
    const turn = ([0, 90, 180, 270] as Rotation[]).find((r) => {
      matare.rotation = r;
      matare.pos = { x: 0, y: 0 };
      const out = layoutOf(config, REAL).placements.find((p) => p.instanceId === matare.instanceId)!
        .ports.find((p) => p.role === "out")!;
      return out.dir === side.dir;
    })!;
    matare.rotation = turn;
    matare.pos = { x: 0, y: 0 };
    const out = layoutOf(config, REAL).placements.find((p) => p.instanceId === matare.instanceId)!
      .ports.find((p) => p.role === "out")!;
    const back = side.dir === "y-" ? 300 : -300;
    matare.pos = { x: side.pos.x - out.pos.x, y: side.pos.y - out.pos.y + back };

    const found = codes(config, REAL);
    expect(found).not.toContain("R-106");
    expect(found).not.toContain("R-104");
    expect(found).not.toContain("R-601");
  });
});
