import { z } from "zod";
import type { Machine } from "./types";

/**
 * Validering av maskindata från admin-vyn. Datan går rakt in i layoutmotorn,
 * så den valideras på samma sätt som all annan indata till servern — och
 * samma schema används i formuläret så att felen syns direkt.
 */

const MM = z.number().int().min(-100_000).max(300_000);
const POSITIVE_MM = z.number().int().min(0).max(300_000);
const RANGE = z
  .tuple([z.number().int().min(0), z.number().int().min(0)])
  .refine(([min, max]) => min <= max, { message: "Min får inte vara större än max." });

export const CATEGORIES = [
  "infeed",
  "stacking",
  "stickers",
  "transport",
  "processing",
  "finishing",
  "outfeed",
  "control",
] as const;

export const DIRECTIONS = ["x+", "x-", "y+", "y-"] as const;

/** Maskin-id används i URL:er, verktygs-enums och konfigurationer. */
export const machineIdSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Endast gemener, siffror och bindestreck.");

export const portSchema = z.object({
  id: z.string().min(1).max(40),
  role: z.enum(["in", "out"]),
  pos: z.object({ x: MM, y: MM }),
  dir: z.enum(DIRECTIONS),
  levelMm: POSITIVE_MM,
  widthMm: RANGE,
  allowsDirectionChange: z.boolean(),
});

export const zoneSchema = z.object({
  type: z.enum(["service", "safety", "pit", "clearance"]),
  box: z.object({ x: MM, y: MM, l: POSITIVE_MM, w: POSITIVE_MM }),
  label: z.string().min(1).max(80),
});

export const optionSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  deltaLengthMm: MM.optional(),
  deltaWidthMm: MM.optional(),
  deltaCapacity: z.number().int().min(-500).max(500).optional(),
  deltaPowerKw: z.number().min(-500).max(500).optional(),
});

export const parameterSchema = z
  .object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(80),
    help: z.string().max(300).optional(),
    type: z.enum(["number", "select", "boolean"]),
    affects: z.enum(["capacity", "lengthMm", "widthMm", "heightMm"]).optional(),

    unit: z.string().max(20).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    pricePerUnit: z.number().min(0).max(10_000_000).optional(),

    choices: z
      .array(
        z.object({
          value: z.string().min(1).max(60),
          label: z.string().min(1).max(80),
          priceDelta: z.number().min(-100_000_000).max(100_000_000).optional(),
        }),
      )
      .max(20)
      .optional(),

    defaultNumber: z.number().optional(),
    defaultText: z.string().max(60).optional(),
    defaultBoolean: z.boolean().optional(),
    priceWhenTrue: z.number().min(-100_000_000).max(100_000_000).optional(),
  })
  .superRefine((parameter, ctx) => {
    if (parameter.type === "select" && !parameter.choices?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "En listparameter behöver minst ett val.",
      });
    }
    if (parameter.type === "number" && parameter.min != null && parameter.max != null) {
      if (parameter.min > parameter.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["min"],
          message: "Min får inte vara större än max.",
        });
      }
    }
    if (parameter.affects && parameter.type !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["affects"],
        message: "Bara talparametrar kan styra mått eller kapacitet.",
      });
    }
  });

export const machineSchema = z
  .object({
    id: machineIdSchema,
    sku: z.string().min(1).max(40),
    name: z.string().min(1).max(80),
    category: z.enum(CATEGORIES),
    summary: z.string().max(400).default(""),
    aiDescription: z.string().max(4000).optional(),
    aux: z.boolean().optional(),
    anchorFor: z.string().max(40).optional(),

    footprint: z.object({
      lengthMm: z.number().int().min(100).max(200_000),
      widthMm: z.number().int().min(100).max(60_000),
      heightMm: z.number().int().min(100).max(40_000),
    }),
    ports: z.array(portSchema).max(8),
    mirrorable: z.boolean(),
    parametricLength: z
      .object({
        minMm: z.number().int().min(100).max(200_000),
        maxMm: z.number().int().min(100).max(200_000),
        pricePerMeter: z.number().int().min(0).max(10_000_000),
      })
      .refine((v) => v.minMm <= v.maxMm, { message: "Minlängd får inte överstiga maxlängd." })
      .optional(),
    operatorPriority: z.number().int().min(0).max(10).optional(),

    zones: z.array(zoneSchema).max(12),
    clearance: z
      .object({
        frontMm: POSITIVE_MM,
        backMm: POSITIVE_MM,
        leftMm: POSITIVE_MM,
        rightMm: POSITIVE_MM,
      })
      .optional(),

    capacity: z.object({
      packagesPerHour: z.number().int().min(0).max(500),
      packageLengthMm: RANGE,
      packageWidthMm: RANGE,
      packageHeightMm: RANGE,
      maxWeightKg: z.number().int().min(0).max(100_000),
    }),

    utilities: z.object({
      powerKw: z.number().min(0).max(2000),
      airNlPerMin: z.number().int().min(0).max(20_000),
    }),
    foundation: z.object({
      pitDepthMm: POSITIVE_MM,
      pointLoadKn: z.number().int().min(0).max(10_000),
    }),

    requires: z.array(z.string().max(40)).max(10).optional(),
    conflictsWith: z.array(z.string().max(40)).max(10).optional(),

    stepFile: z.string().max(120).optional(),
    leadTimeWeeks: z.number().int().min(0).max(200),
    catalogueNumber: z.string().max(10).optional(),
    dimensionsVerified: z.boolean().optional(),
    options: z.array(optionSchema).max(20),

    parameters: z.array(parameterSchema).max(20).optional(),
    images: z.array(z.string().max(80)).max(8).optional(),
    productUrl: z.string().max(400).optional(),
    datasheetUrl: z.string().max(400).optional(),
  })
  .superRefine((machine, ctx) => {
    // En maskin i kedjan måste ha både in- och utport, annars kan solvern
    // aldrig koppla in den. Hjälpobjekt saknar portar helt.
    if (machine.aux) {
      if (machine.ports.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ports"],
          message: "Hjälpobjekt ingår inte i kedjan och ska inte ha portar.",
        });
      }
      return;
    }
    const roles = new Set(machine.ports.map((p) => p.role));
    if (!roles.has("in") || !roles.has("out")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ports"],
        message: "En maskin i kedjan behöver minst en inport och en utport.",
      });
    }
    const ids = machine.ports.map((p) => p.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ports"],
        message: "Portarna måste ha unika id.",
      });
    }
    for (const [index, port] of machine.ports.entries()) {
      if (port.pos.x < 0 || port.pos.x > machine.footprint.lengthMm) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ports", index, "pos", "x"],
          message: `X måste ligga mellan 0 och ${machine.footprint.lengthMm} mm.`,
        });
      }
      if (port.pos.y < 0 || port.pos.y > machine.footprint.widthMm) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ports", index, "pos", "y"],
          message: `Y måste ligga mellan 0 och ${machine.footprint.widthMm} mm.`,
        });
      }
    }
    const optionIds = machine.options.map((o) => o.id);
    if (new Set(optionIds).size !== optionIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Optionerna måste ha unika id.",
      });
    }
    const parameterIds = (machine.parameters ?? []).map((p) => p.id);
    if (new Set(parameterIds).size !== parameterIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters"],
        message: "Parametrarna måste ha unika id.",
      });
    }
  });

export const priceEntrySchema = z.object({
  list: z.number().int().min(0).max(1_000_000_000),
  cost: z.number().int().min(0).max(1_000_000_000),
  options: z.record(z.string().max(40), z.number().int().min(0).max(100_000_000)),
});

export const priceBookSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  validFrom: z.string().max(20),
  validUntil: z.string().max(20),
  currency: z.literal("SEK"),
  entries: z.record(z.string().max(40), priceEntrySchema),
  installFactor: z.record(z.string().max(40), z.number().min(0).max(3)),
  controlFactor: z.number().min(0).max(3),
  freight: z.number().int().min(0).max(100_000_000),
  indicationSpread: z.object({
    low: z.number().min(0.1).max(1),
    high: z.number().min(1).max(5),
  }),
});

/** Bilder lagras som data-URI:er i dokumentet och serveras via egen rutt. */
export const assetSchema = z.object({
  id: z.string().min(1).max(80),
  machineId: z.string().max(40),
  name: z.string().max(160),
  mime: z.enum(["image/webp", "image/jpeg", "image/png"]),
  /** Base64 utan prefix. Cirka 1,4 MB råstorlek som tak. */
  data: z.string().max(2_000_000),
});

export const libraryDocumentSchema = z
  .object({
    machines: z.array(machineSchema).max(200),
    priceBook: priceBookSchema,
    assets: z.array(assetSchema).max(200).default([]),
    updatedAt: z.string().optional(),
    updatedBy: z.string().max(80).optional(),
  })
  .superRefine((doc, ctx) => {
    const ids = doc.machines.map((m) => m.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["machines"],
        message: `Dubblerade maskin-id: ${[...new Set(duplicates)].join(", ")}.`,
      });
    }
    const known = new Set(ids);
    for (const [index, machine] of doc.machines.entries()) {
      for (const req of machine.requires ?? []) {
        if (known.has(req)) continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["machines", index, "requires"],
          message: `${machine.name} kräver "${req}" som inte finns i biblioteket.`,
        });
      }
    }
  });

export type LibraryAsset = z.infer<typeof assetSchema>;

/**
 * Dokumenttypen använder domänens Machine, inte zod-inferensen — schemat är
 * grinden vid systemgränsen, typerna är sanningen inne i systemet.
 */
export type LibraryDocument = {
  machines: Machine[];
  priceBook: z.infer<typeof priceBookSchema>;
  assets: LibraryAsset[];
  updatedAt?: string;
  updatedBy?: string;
};

/** Samlar zod-fel till en läsbar lista för admin-formuläret. */
export function collectIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
