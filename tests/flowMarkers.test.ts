import { describe, expect, it } from "vitest";
import { activateMarker, addMarker, markerLabel, MAX_MARKERS, removeMarker } from "@/lib/flowMarkers";
import { configurationSchema } from "@/lib/schema";
import { DEFAULT_FLOW, emptyConfig } from "@/lib/templates";
import type { Flow } from "@/lib/types";

/**
 * Flera start- och slutpunkter, var och en med en motivering.
 *
 * Linjen byggs från den aktiva punkten; alternativen ligger kvar för att
 * jämföras och kan göras aktiva — utan att något försvinner på vägen.
 */

const flow = (): Flow => JSON.parse(JSON.stringify(DEFAULT_FLOW));

describe("alternativa punkter", () => {
  it("lägger till en startpunkt bredvid den aktiva och numrerar den", () => {
    const f = flow();
    const marker = addMarker(f, "start")!;
    expect(f.markers).toHaveLength(1);
    expect(marker.pos.x).toBe(f.startPoint.x);
    expect(marker.pos).not.toEqual(f.startPoint);
    expect(markerLabel(f, marker)).toBe("Start 2");
  });

  it("byter plats och kommentar när ett alternativ görs aktivt", () => {
    const f = flow();
    f.startComment = "Från sågen";
    const marker = addMarker(f, "start", { x: 9000, y: 1000 })!;
    marker.comment = "Från hyvleriet";

    activateMarker(f, marker.id);
    expect(f.startPoint).toEqual({ x: 9000, y: 1000 });
    expect(f.startComment).toBe("Från hyvleriet");
    expect(f.markers![0].comment).toBe("Från sågen");
    expect(f.markers![0].pos).toEqual(DEFAULT_FLOW.startPoint);
  });

  it("flyttar in ett slutalternativ när ingen slutpunkt är satt", () => {
    const f = flow();
    const marker = addMarker(f, "end", { x: 30_000, y: 5000 })!;
    marker.comment = "Port B";
    activateMarker(f, marker.id);
    expect(f.endPoint).toEqual({ x: 30_000, y: 5000 });
    expect(f.endComment).toBe("Port B");
    expect(f.markers).toHaveLength(0);
  });

  it("tar bort och har ett tak", () => {
    const f = flow();
    const first = addMarker(f, "end")!;
    removeMarker(f, first.id);
    expect(f.markers).toHaveLength(0);
    for (let i = 0; i < MAX_MARKERS; i++) addMarker(f, "start");
    expect(addMarker(f, "start")).toBeNull();
  });

  it("går igenom serverns validering", () => {
    const config = emptyConfig();
    addMarker(config.flow, "start")!.comment = "Från hyvleriet";
    config.flow.startComment = "Från sågen";
    const parsed = configurationSchema.parse(config);
    expect(parsed.flow.markers?.[0].comment).toBe("Från hyvleriet");
    expect(parsed.flow.startComment).toBe("Från sågen");
  });
});
