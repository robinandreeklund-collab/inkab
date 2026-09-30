import { describe, expect, it } from "vitest";
import { activateMarker, addMarker, markerNumber, MAX_MARKERS, removeMarker } from "@/lib/flowMarkers";
import { configurationSchema } from "@/lib/schema";
import { DEFAULT_FLOW, DEFAULT_HALL, emptyConfig } from "@/lib/templates";
import type { Flow } from "@/lib/types";

/**
 * Flera start- och slutpunkter, var och en med en motivering.
 *
 * Nya maskiner läggs vid den aktiva startpunkten; alternativen ligger kvar för
 * att jämföras och kan göras aktiva — utan att något försvinner på vägen.
 */

const flow = (): Flow => JSON.parse(JSON.stringify(DEFAULT_FLOW));

describe("start- och slutpunkter", () => {
  it("lägger en alternativ start bredvid den aktiva och numrerar den efter den", () => {
    const f = flow();
    const marker = addMarker(f, "start", DEFAULT_HALL)!;
    expect(f.markers).toHaveLength(1);
    expect(marker.pos.x).toBe(f.startPoint.x);
    expect(marker.pos).not.toEqual(f.startPoint);
    expect(markerNumber(f, marker)).toBe(2);
  });

  it("lägger en slutpunkt i hallens bortre ände och numrerar från ett", () => {
    const f = flow();
    const marker = addMarker(f, "end", DEFAULT_HALL)!;
    expect(marker.pos.x).toBe(DEFAULT_HALL.lengthMm - 2000);
    expect(markerNumber(f, marker)).toBe(1);
  });

  it("byter plats och kommentar när en alternativ start görs aktiv", () => {
    const f = flow();
    f.startComment = "Från sågen";
    const marker = addMarker(f, "start", DEFAULT_HALL, { x: 9000, y: 1000 })!;
    marker.comment = "Från hyvleriet";

    activateMarker(f, marker.id);
    expect(f.startPoint).toEqual({ x: 9000, y: 1000 });
    expect(f.startComment).toBe("Från hyvleriet");
    expect(f.markers![0].comment).toBe("Från sågen");
    expect(f.markers![0].pos).toEqual(DEFAULT_FLOW.startPoint);
  });

  it("gör inte en slutpunkt till startpunkt", () => {
    const f = flow();
    const marker = addMarker(f, "end", DEFAULT_HALL)!;
    activateMarker(f, marker.id);
    expect(f.startPoint).toEqual(DEFAULT_FLOW.startPoint);
  });

  it("tar bort och har ett tak", () => {
    const f = flow();
    const first = addMarker(f, "end", DEFAULT_HALL)!;
    removeMarker(f, first.id);
    expect(f.markers).toHaveLength(0);
    for (let i = 0; i < MAX_MARKERS; i++) addMarker(f, "start", DEFAULT_HALL);
    expect(addMarker(f, "start", DEFAULT_HALL)).toBeNull();
  });

  it("går igenom serverns validering", () => {
    const config = emptyConfig();
    addMarker(config.flow, "end", config.hall)!.comment = "Trucken hämtar vid port B";
    config.flow.startComment = "Från sågen";
    const parsed = configurationSchema.parse(config);
    expect(parsed.flow.markers?.[0].comment).toBe("Trucken hämtar vid port B");
    expect(parsed.flow.startComment).toBe("Från sågen");
  });
});
