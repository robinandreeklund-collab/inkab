import "server-only";
import { computeLayout } from "@/lib/layout";
import {
  BUILTIN_LIBRARY,
  CATEGORY_LABEL,
  getMachine,
  type MachineLibrary,
} from "@/lib/library";
import { lineItem } from "@/lib/templates";
import { meters } from "@/lib/format";
import { priceConfiguration, type Role } from "@/lib/server/pricing";
import type { PriceBook } from "@/lib/server/pricebook";
import type { Configuration } from "@/lib/types";

/**
 * Verktygsskalet. Assistenten når systemet ENBART via de här funktionerna:
 * den kan inte skriva geometri, hitta på maskiner eller sätta priser själv.
 * Varje skrivverktyg returnerar den omräknade layouten så att modellen
 * omedelbart ser konsekvensen av sin ändring — samma återkoppling som en
 * människa får i gränssnittet.
 */

export type Variant = {
  id: string;
  name: string;
  description: string;
  config: Configuration;
};

export type ToolContext = {
  original: Configuration;
  draft: Configuration;
  variants: Variant[];
  role: Role;
  library: MachineLibrary;
  priceBook: PriceBook;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Intervallen ligger här i stället för i schemat — se toolDefinitions. */
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Hallens portar, som assistenten behöver för att resonera om truckens väg. */
function doorSummary(config: Configuration) {
  return config.drawn
    .filter((d) => d.kind === "door")
    .map((d) => ({
      name: d.name,
      xM: Number(meters(d.x).replace(",", ".")),
      yM: Number(meters(d.y).replace(",", ".")),
      widthM: Number(meters(Math.max(d.l, d.w)).replace(",", ".")),
    }));
}

export function layoutSummary(
  config: Configuration,
  library: MachineLibrary = BUILTIN_LIBRARY,
) {
  const layout = computeLayout(config, library);
  return {
    totalLengthM: Number(
      meters(layout.metrics.totalLengthMm).replace(",", "."),
    ),
    totalWidthM: Number(meters(layout.metrics.totalWidthMm).replace(",", ".")),
    footprintM2: layout.metrics.footprintM2,
    throughputPerHour: layout.metrics.throughputPerHour,
    bottleneck: layout.metrics.bottleneck?.name ?? null,
    totalPowerKw: layout.metrics.totalPowerKw,
    machines: layout.placements.map((p) => ({
      instanceId: p.instanceId,
      machineId: p.machineId,
      name: p.machine.name,
      pos: p.pos,
      aux: p.aux,
      xM: Number(meters(p.bbox.x).replace(",", ".")),
      yM: Number(meters(p.bbox.y).replace(",", ".")),
      lengthM: Number(meters(p.size.lengthMm).replace(",", ".")),
      widthM: Number(meters(p.size.widthMm).replace(",", ".")),
    })),
    truckZones: layout.aisles.map((a) => ({
      label: a.label,
      xM: Number(meters(a.box.x).replace(",", ".")),
      yM: Number(meters(a.box.y).replace(",", ".")),
      lengthM: Number(meters(a.box.l).replace(",", ".")),
      widthM: Number(meters(a.box.w).replace(",", ".")),
    })),
    doors: doorSummary(config),
    diagnostics: layout.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      title: d.title,
      detail: d.detail,
      hasSuggestedFix: !!d.fix,
    })),
    errorCount: layout.diagnostics.filter((d) => d.severity === "error").length,
    warningCount: layout.diagnostics.filter((d) => d.severity === "warning")
      .length,
  };
}

const SIDE = { type: "string", enum: ["right", "left"] } as const;

/**
 * Intervall klipps på servern i stället för i schemat: med strict: true tar
 * API:t inte emot minimum/maximum, minLength/maxLength eller multipleOf.
 * Gränserna står i beskrivningen så att modellen ändå känner dem, och
 * executeTool ser till att de hålls. Testet i tests/ai-tools.test.ts vaktar
 * att inget otillåtet schlinker in igen.
 */
export function toolDefinitions(library: MachineLibrary = BUILTIN_LIBRARY) {
  return [
    {
      name: "get_machine_library",
      description:
        "Hämtar maskinbiblioteket med mått, kapacitet, portar, beroenden och optioner. " +
        "Anropa alltid detta innan du föreslår en maskin — hitta aldrig på maskin-id. " +
        "Innehåller inga priser; använd estimate_price för det.",
      input_schema: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            enum: Object.keys(CATEGORY_LABEL),
            description: "Filtrera på kategori. Utelämna för hela biblioteket.",
          },
        },
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "get_current_layout",
      description:
        "Hämtar kundens nuvarande layout: maskinernas placering i meter, mått, " +
        "kapacitet, truckgata och all diagnostik från regelmotorn.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "set_flow",
      description:
        "Ändrar ett eller flera av de fem flödesvalen i arbetskopian och räknar om " +
        "layouten. Returnerar den nya layouten med diagnostik.",
      input_schema: {
        type: "object" as const,
        properties: {
          infeedFrom: { type: "string", enum: ["straight", "right", "left"] },
          controlDeskSide: SIDE,
          stickerMagazineSide: SIDE,
          truckPickupSide: SIDE,
          finalConveyorLengthMm: {
            type: "integer",
            description: "Längd i millimeter, mellan 1000 och 40000. Värden utanför klipps.",
          },
        },
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "add_machine",
      description:
        "Lägger till en maskin i arbetskopians linje och räknar om layouten.",
      input_schema: {
        type: "object" as const,
        properties: {
          machineId: {
            type: "string",
            enum: library.machines.map((m) => m.id),
          },
          atIndex: {
            type: "integer",
            description: "Position i kedjan, 0 eller större. Utelämna för att lägga sist.",
          },
          variantId: {
            type: "string",
            description:
              "Utförande, för maskiner som finns i flera längder. Id:na står i " +
              "maskinbiblioteket. Utelämna för maskinens förval.",
          },
        },
        required: ["machineId"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "remove_machine",
      description:
        "Tar bort en maskin ur arbetskopians linje via dess instanceId.",
      input_schema: {
        type: "object" as const,
        properties: { instanceId: { type: "string" } },
        required: ["instanceId"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "set_hall",
      description: "Ändrar hallens mått i arbetskopian.",
      input_schema: {
        type: "object" as const,
        properties: {
          lengthMm: {
            type: "integer",
            description: "Hallens längd i millimeter, mellan 5000 och 300000.",
          },
          widthMm: {
            type: "integer",
            description: "Hallens bredd i millimeter, mellan 5000 och 150000.",
          },
          clearHeightMm: {
            type: "integer",
            description: "Fri höjd i millimeter, mellan 2000 och 30000.",
          },
        },
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "estimate_price",
      description:
        "Serverberäknat pris för arbetskopian. Detta är den ENDA källan till " +
        "prisuppgifter — nämn aldrig belopp som inte kommer härifrån.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "propose_variant",
      description:
        "Sparar arbetskopians nuvarande tillstånd som ett namngivet förslag som " +
        "kunden kan förhandsgranska och själv välja att använda. Arbetskopian " +
        "återställs därefter till kundens ursprungliga layout så att du kan bygga " +
        "nästa förslag. Applicera aldrig en ändring åt kunden — föreslå den.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Kort rubrik, t.ex. 'Spegla linjen'.",
          },
          description: {
            type: "string",
            description:
              "En eller två meningar om vad förslaget innebär och varför.",
          },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
      strict: true,
    },
  ];
}

export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): unknown {
  switch (name) {
    case "get_machine_library": {
      const category = input.category as string | undefined;
      return ctx.library.machines
        .filter((m) => !category || m.category === category)
        .map((m) => ({
          id: m.id,
          sku: m.sku,
          name: m.name,
          category: m.category,
          categoryLabel: CATEGORY_LABEL[m.category],
          summary: m.summary,
          aux: !!m.aux,
          lengthM: m.footprint.lengthMm / 1000,
          widthM: m.footprint.widthMm / 1000,
          heightM: m.footprint.heightMm / 1000,
          capacityPerHour: m.capacity.packagesPerHour,
          powerKw: m.utilities.powerKw,
          mirrorable: m.mirrorable,
          parametricLength: !!m.parametricLength,
          changesDirection: m.ports.some(
            (p) => p.allowsDirectionChange && p.role === "out",
          ),
          requires: m.requires ?? [],
          options: m.options.map((o) => ({ id: o.id, name: o.name })),
        }));
    }

    case "get_current_layout":
      return layoutSummary(ctx.draft, ctx.library);

    case "set_flow": {
      const patch = { ...(input as Partial<Configuration["flow"]>) };
      if (typeof patch.finalConveyorLengthMm === "number") {
        patch.finalConveyorLengthMm = clamp(patch.finalConveyorLengthMm, 1000, 40000);
      }
      Object.assign(ctx.draft.flow, patch);
      return { applied: patch, layout: layoutSummary(ctx.draft, ctx.library) };
    }

    case "add_machine": {
      const machineId = String(input.machineId);
      if (!getMachine(machineId, ctx.library)) {
        return {
          error: `Okänd maskin: ${machineId}. Anropa get_machine_library först.`,
        };
      }
      const machine = getMachine(machineId, ctx.library)!;
      const item = lineItem(machineId);

      // Utförandet valideras mot biblioteket: assistenten får inte hitta på
      // ett mått som inte finns att bygga.
      const variants = machine.variants ?? [];
      if (variants.length > 0) {
        const wanted = input.variantId ? String(input.variantId) : null;
        if (wanted && !variants.some((v) => v.id === wanted)) {
          return {
            error:
              `Okänt utförande: ${wanted}. ${machine.name} finns som ` +
              `${variants.map((v) => `${v.id} (${v.name})`).join(", ")}.`,
          };
        }
        item.variantId = wanted ?? variants[0].id;
      }

      const at =
        typeof input.atIndex === "number"
          ? input.atIndex
          : ctx.draft.line.length;
      ctx.draft.line.splice(
        Math.max(0, Math.min(ctx.draft.line.length, at)),
        0,
        item,
      );
      return {
        added: { instanceId: item.instanceId, machineId, variantId: item.variantId },
        layout: layoutSummary(ctx.draft, ctx.library),
      };
    }

    case "remove_machine": {
      const instanceId = String(input.instanceId);
      const before = ctx.draft.line.length;
      ctx.draft.line = ctx.draft.line.filter(
        (i) => i.instanceId !== instanceId,
      );
      if (ctx.draft.line.length === before) {
        return {
          error: `Ingen maskin med instanceId ${instanceId} finns i linjen.`,
        };
      }
      return {
        removed: instanceId,
        layout: layoutSummary(ctx.draft, ctx.library),
      };
    }

    case "set_hall": {
      const hall = input as Partial<Configuration["hall"]>;
      if (typeof hall.lengthMm === "number") {
        ctx.draft.hall.lengthMm = clamp(Math.round(hall.lengthMm), 5000, 300_000);
      }
      if (typeof hall.widthMm === "number") {
        ctx.draft.hall.widthMm = clamp(Math.round(hall.widthMm), 5000, 150_000);
      }
      if (typeof hall.clearHeightMm === "number") {
        ctx.draft.hall.clearHeightMm = clamp(Math.round(hall.clearHeightMm), 2000, 30_000);
      }
      return {
        hall: ctx.draft.hall,
        layout: layoutSummary(ctx.draft, ctx.library),
      };
    }

    case "estimate_price": {
      const result = priceConfiguration(
        ctx.draft,
        ctx.role,
        ctx.library,
        ctx.priceBook,
      );
      return {
        role: result.role,
        priceBook: result.priceBookName,
        indicationLowSek: result.indication.lowSek,
        indicationHighSek: result.indication.highSek,
        totals: result.totals,
        note: result.note,
      };
    }

    case "propose_variant": {
      const variant: Variant = {
        id: `v${ctx.variants.length + 1}`,
        name: String(input.name),
        description: String(input.description),
        config: clone(ctx.draft),
      };
      ctx.variants.push(variant);
      const summary = layoutSummary(variant.config, ctx.library);
      // Arbetskopian nollställs så att nästa förslag utgår från kundens layout.
      ctx.draft = clone(ctx.original);
      return {
        saved: variant.id,
        name: variant.name,
        layout: summary,
        note: "Arbetskopian är återställd till kundens ursprungliga layout.",
      };
    }

    default:
      return { error: `Okänt verktyg: ${name}` };
  }
}
