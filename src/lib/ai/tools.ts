import "server-only";
import { computeLayout } from "@/lib/layout";
import { CATEGORY_LABEL, MACHINES, getMachine } from "@/lib/library";
import { lineItem } from "@/lib/templates";
import { meters } from "@/lib/format";
import { priceConfiguration, type Role } from "@/lib/server/pricing";
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
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function layoutSummary(config: Configuration) {
  const layout = computeLayout(config);
  return {
    totalLengthM: Number(meters(layout.metrics.totalLengthMm).replace(",", ".")),
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
    truckAisle: layout.aisle
      ? { side: layout.aisle.side, widthM: Number(meters(layout.aisle.widthMm).replace(",", ".")) }
      : null,
    diagnostics: layout.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      title: d.title,
      detail: d.detail,
      hasSuggestedFix: !!d.fix,
    })),
    errorCount: layout.diagnostics.filter((d) => d.severity === "error").length,
    warningCount: layout.diagnostics.filter((d) => d.severity === "warning").length,
  };
}

const SIDE = { type: "string", enum: ["right", "left"] } as const;

export const TOOL_DEFINITIONS = [
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
        finalConveyorLengthMm: { type: "integer", minimum: 1000, maximum: 40000 },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "add_machine",
    description: "Lägger till en maskin i arbetskopians linje och räknar om layouten.",
    input_schema: {
      type: "object" as const,
      properties: {
        machineId: { type: "string", enum: MACHINES.map((m) => m.id) },
        atIndex: {
          type: "integer",
          minimum: 0,
          description: "Position i kedjan. Utelämna för att lägga sist.",
        },
      },
      required: ["machineId"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "remove_machine",
    description: "Tar bort en maskin ur arbetskopians linje via dess instanceId.",
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
        lengthMm: { type: "integer", minimum: 5000, maximum: 300000 },
        widthMm: { type: "integer", minimum: 5000, maximum: 150000 },
        clearHeightMm: { type: "integer", minimum: 2000, maximum: 30000 },
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
        name: { type: "string", description: "Kort rubrik, t.ex. 'Spegla linjen'." },
        description: {
          type: "string",
          description: "En eller två meningar om vad förslaget innebär och varför.",
        },
      },
      required: ["name", "description"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): unknown {
  switch (name) {
    case "get_machine_library": {
      const category = input.category as string | undefined;
      return MACHINES.filter((m) => !category || m.category === category).map((m) => ({
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
        changesDirection: m.ports.some((p) => p.allowsDirectionChange && p.role === "out"),
        requires: m.requires ?? [],
        options: m.options.map((o) => ({ id: o.id, name: o.name })),
      }));
    }

    case "get_current_layout":
      return layoutSummary(ctx.draft);

    case "set_flow": {
      const patch = input as Partial<Configuration["flow"]>;
      Object.assign(ctx.draft.flow, patch);
      return { applied: patch, layout: layoutSummary(ctx.draft) };
    }

    case "add_machine": {
      const machineId = String(input.machineId);
      if (!getMachine(machineId)) {
        return { error: `Okänd maskin: ${machineId}. Anropa get_machine_library först.` };
      }
      const item = lineItem(machineId);
      const at = typeof input.atIndex === "number" ? input.atIndex : ctx.draft.line.length;
      ctx.draft.line.splice(Math.max(0, Math.min(ctx.draft.line.length, at)), 0, item);
      return { added: { instanceId: item.instanceId, machineId }, layout: layoutSummary(ctx.draft) };
    }

    case "remove_machine": {
      const instanceId = String(input.instanceId);
      const before = ctx.draft.line.length;
      ctx.draft.line = ctx.draft.line.filter((i) => i.instanceId !== instanceId);
      if (ctx.draft.line.length === before) {
        return { error: `Ingen maskin med instanceId ${instanceId} finns i linjen.` };
      }
      return { removed: instanceId, layout: layoutSummary(ctx.draft) };
    }

    case "set_hall": {
      Object.assign(ctx.draft.hall, input);
      return { hall: ctx.draft.hall, layout: layoutSummary(ctx.draft) };
    }

    case "estimate_price": {
      const result = priceConfiguration(ctx.draft, ctx.role);
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
      const summary = layoutSummary(variant.config);
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
