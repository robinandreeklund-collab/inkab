import { z } from "zod";

/** Serverns validering av inkommande konfiguration. Klienten är aldrig betrodd. */

const vec2 = z.object({ x: z.number().finite(), y: z.number().finite() });

export const lineItemSchema = z.object({
  instanceId: z.string().min(1).max(64),
  machineId: z.string().min(1).max(64),
  selectedOptions: z.array(z.string().max(64)).max(12),
  manualOffset: vec2.optional(),
});

export const drawnSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["wall", "nogo"]),
  name: z.string().max(120),
  x: z.number().finite(),
  y: z.number().finite(),
  l: z.number().finite().nonnegative(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
});

export const flowSchema = z.object({
  infeedFrom: z.enum(["straight", "right", "left"]),
  controlDeskSide: z.enum(["right", "left"]),
  stickerMagazineSide: z.enum(["right", "left"]),
  truckPickupSide: z.enum(["right", "left"]),
  finalConveyorLengthMm: z.number().int().min(1000).max(40000),
});

export const configurationSchema = z.object({
  version: z.literal(1),
  projectName: z.string().min(1).max(120),
  hall: z.object({
    lengthMm: z.number().int().min(5000).max(300000),
    widthMm: z.number().int().min(5000).max(150000),
    clearHeightMm: z.number().int().min(2000).max(30000),
  }),
  flow: flowSchema,
  product: z.object({
    packageLengthMm: z.number().int().min(500).max(12000),
    packageWidthMm: z.number().int().min(200).max(4000),
    packageHeightMm: z.number().int().min(100).max(4000),
    packageWeightKg: z.number().int().min(1).max(20000),
    targetPackagesPerHour: z.number().int().min(1).max(200),
  }),
  line: z.array(lineItemSchema).max(40),
  drawn: z.array(drawnSchema).max(80),
});

export type ValidatedConfiguration = z.infer<typeof configurationSchema>;
