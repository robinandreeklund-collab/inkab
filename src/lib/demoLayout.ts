import type { Configuration, DrawnObject, Dimension } from "./types";

/**
 * Demoanläggningen på startsidan.
 *
 * Till skillnad från mallarna är det här ingen maskinlista som läggs ut på
 * rad — det är en hall någon faktiskt har ritat: femton maskiner där de
 * står, tre portar, fem zoner och två måttlinjer. Mallarna visar vad man
 * kan beställa; den här visar vad verktyget är till för.
 *
 * Den öppnar med anmärkningar, och det är meningen. Kunden har ritat en
 * spärrad yta tvärs över två maskiner, och målkapaciteten nås inte med den
 * flaskhals linjen har. Båda stämmer, och en demo som visar ett regelverk
 * som faktiskt säger ifrån är ärligare än en som är konstruerad för att
 * vara tyst. Vilka koder det gäller står i tests/demoLayout.test.ts, så att
 * de inte kan ändras obemärkt.
 *
 * Positionerna är millimeter i hallens koordinater och får inte räknas om:
 * det är just de som är ritningen. Instans-id sätts när den öppnas, så att
 * två flikar inte delar samma.
 */

/** Maskinerna, i den ordning de står i maskinlistan. */
export const DEMO_LINE: Omit<Configuration["line"][number], "instanceId">[] = [
  { machineId: "maskin-18", pos: { x: 49750, y: 6250 }, rotation: 180, selectedOptions: [] },
  { machineId: "maskin-18", pos: { x: 37000, y: 6000 }, rotation: 180, selectedOptions: [] },
  { machineId: "kedjekanal-hojsank-sidvis", pos: { x: 31000, y: 14000 }, rotation: 90, selectedOptions: [] },
  { machineId: "kedjetransportor", variantId: "ve70y", pos: { x: 49750, y: 5000 }, rotation: 90, selectedOptions: [] },
  { machineId: "kedjekanal-hojsank", pos: { x: 49750, y: 8250 }, rotation: 90, selectedOptions: [] },
  { machineId: "rullbana", variantId: "vs9a6", pos: { x: 38000, y: 14000 }, selectedOptions: [] },
  { machineId: "rullbana", variantId: "vs9a6", pos: { x: 25750, y: 14000 }, selectedOptions: [] },
  { machineId: "rullbana", variantId: "vs9a6", pos: { x: 19000, y: 18000 }, selectedOptions: [] },
  { machineId: "rullbana", variantId: "vs9a6", pos: { x: 6750, y: 18000 }, selectedOptions: [] },
  { machineId: "emballageutlaggare", pos: { x: 20250, y: 16750 }, selectedOptions: [] },
  { machineId: "kedjekanal-hojsank", pos: { x: 6750, y: 25250 }, rotation: 270, selectedOptions: [] },
  { machineId: "paketlyft-fast", pos: { x: 7500, y: 19500 }, rotation: 270, selectedOptions: [] },
  { machineId: "kedjekanal-hojsank", pos: { x: 36750, y: 8250 }, rotation: 90, selectedOptions: [] },
  { machineId: "kedjetransportor", variantId: "ve70y", pos: { x: 36750, y: 5000 }, rotation: 90, selectedOptions: [] },
  { machineId: "manoverpulpet", pos: { x: 15500, y: 9500 }, selectedOptions: [] },
];

export const DEMO_HALL: Configuration["hall"] = {
  lengthMm: 60000,
  widthMm: 30000,
  clearHeightMm: 6000,
};

export const DEMO_DRAWN: DrawnObject[] = [
  { id: "door-mwahwm34", kind: "door", name: "Port A", x: 42750, y: -150, l: 8750, w: 300, h: 5000 },
  { id: "door-mwahwr5r", kind: "door", name: "Port B", x: 30750, y: -150, l: 7750, w: 300, h: 5000 },
  { id: "truck-mwai6naw", kind: "zone", zone: "truck", name: "Truckzon 1", x: 6750, y: 25500, l: 5000, w: 4000, h: 0 },
  { id: "operator-mwai6yk7", kind: "zone", zone: "operator", name: "Operatörsplats 1", x: 7000, y: 11500, l: 18750, w: 6250, h: 0 },
  { id: "electrical-mwai75ds", kind: "zone", zone: "electrical", name: "Elcentral 1", x: 7250, y: 8750, l: 7500, w: 2250, h: 0 },
  { id: "service-mwai7nww", kind: "zone", zone: "service", name: "Serviceyta 1", x: 26250, y: 2750, l: 5500, w: 11000, h: 0 },
  { id: "nogo-mwai7yy0", kind: "zone", zone: "nogo", name: "Spärrad yta 1", x: 37000, y: 2500, l: 7500, w: 11250, h: 0 },
  { id: "door-mwaibd3s", kind: "door", name: "Port C", x: 6000, y: 29850, l: 7000, w: 300, h: 5000 },
];

export const DEMO_DIMENSIONS: Dimension[] = [
  { id: "dim-mwaibrsg-2", from: { x: 12300, y: 26320 }, to: { x: 31280, y: 26320 }, note: "avstånd 1" },
  { id: "dim-mwaic6v4-5", from: { x: 44470, y: 2340 }, to: { x: 37120, y: 2280 }, note: "Avstånd 2" },
];

export const DEMO_PRODUCT: Configuration["product"] = {
  packageLengthMm: 5400,
  packageWidthMinMm: 800,
  packageWidthMaxMm: 1150,
  packageHeightMm: 1100,
  packageWeightKg: 1800,
  targetPackagesPerHour: 18,
};
