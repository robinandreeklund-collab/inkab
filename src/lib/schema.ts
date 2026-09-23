import { z } from "zod";

/** Serverns validering av inkommande konfiguration. Klienten är aldrig betrodd. */

const vec2 = z.object({ x: z.number().finite(), y: z.number().finite() });

export const lineItemSchema = z.object({
  instanceId: z.string().min(1).max(64),
  machineId: z.string().min(1).max(64),
  variantId: z.string().max(64).optional(),
  /*
   * Positionen är valfri: en konfiguration sparad före fri placering har
   * ingen, och får då en plats på ledig yta när layouten räknas ut. Gamla
   * fält (portval, grenar, matarlinjer) faller bort av sig själva — zod
   * släpper igenom okända nycklar utan att ta med dem vidare.
   */
  pos: vec2.optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  mirrored: z.boolean().optional(),
  lengthMm: z.number().int().min(100).max(60000).optional(),
  selectedOptions: z.array(z.string().max(64)).max(12),
  parameters: z
    .record(z.string().max(64), z.union([z.string().max(200), z.number().finite(), z.boolean()]))
    .optional(),
});

export const drawnSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["wall", "door", "truck", "nogo"]),
  name: z.string().max(120),
  x: z.number().finite(),
  y: z.number().finite(),
  l: z.number().finite().nonnegative(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
});

export const flowSchema = z.object({
  truckPickupSide: z.enum(["right", "left"]),
  startPoint: vec2,
});

export const configurationSchema = z.object({
  version: z.literal(1),
  projectName: z.string().min(1).max(120),
  // Rena underlagsuppgifter. Valfria, och validerade som allt annat som kan
  // komma in via en delningslänk.
  customer: z
    .object({
      company: z.string().max(120).optional(),
      contact: z.string().max(120).optional(),
      reference: z.string().max(60).optional(),
      site: z.string().max(120).optional(),
    })
    .optional(),
  hall: z.object({
    lengthMm: z.number().int().min(5000).max(300000),
    widthMm: z.number().int().min(5000).max(150000),
    clearHeightMm: z.number().int().min(2000).max(30000),
  }),
  flow: flowSchema,
  product: z
    .object({
      packageLengthMm: z.number().int().min(500).max(12000),
      packageWidthMinMm: z.number().int().min(200).max(4000),
      packageWidthMaxMm: z.number().int().min(200).max(4000),
      packageHeightMm: z.number().int().min(100).max(4000),
      packageWeightKg: z.number().int().min(1).max(20000),
      targetPackagesPerHour: z.number().int().min(1).max(200),
    })
    .refine((p) => p.packageWidthMinMm <= p.packageWidthMaxMm, {
      message: "Minsta virkesbredd får inte överstiga den största.",
      path: ["packageWidthMinMm"],
    }),
  line: z.array(lineItemSchema).max(40),
  drawn: z.array(drawnSchema).max(80),
});

export type ValidatedConfiguration = z.infer<typeof configurationSchema>;
