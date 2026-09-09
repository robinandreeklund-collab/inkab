import "server-only";
import { computeLayout } from "@/lib/layout";
import { removeWithBranches, segmentEndIndex, usedOutPorts } from "@/lib/branches";
import { MAX_DRAWN, planToDrawn, type Plan } from "@/lib/drawing";
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
  /**
   * Om hallen ritades med belagd skala. null tills draw_hall använts.
   *
   * Assistenten uppmanas att säga ifrån själv när skalan är gissad, men en
   * uppmaning är inte en garanti. Flaggan gör att gränssnittet kan säga det
   * oavsett vad modellen skriver.
   */
  scaleVerified?: boolean | null;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Intervallen ligger här i stället för i schemat — se toolDefinitions. */
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const m = (mm: number) => Number(meters(mm).replace(",", "."));

/** Hallens portar, som assistenten behöver för att resonera om truckens väg. */
function doorSummary(config: Configuration) {
  return config.drawn
    .filter((d) => d.kind === "door")
    .map((d) => ({
      name: d.name,
      xM: m(d.x),
      yM: m(d.y),
      widthM: m(Math.max(d.l, d.w)),
    }));
}

/**
 * Det som är ritat i hallen. Assistenten måste kunna se sin egen ritning för
 * att kunna rätta den — annars ritar den om alltihop varje gång kunden säger
 * att en vägg sitter fel.
 */
function drawnSummary(config: Configuration) {
  return config.drawn
    .filter((d) => d.kind !== "door")
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      xM: m(d.x),
      yM: m(d.y),
      lengthM: m(d.l),
      widthM: m(d.w),
    }));
}

/**
 * Layouten som assistenten ser den.
 *
 * Varje skrivverktyg svarar med en sammanfattning, och varje svar skickas med
 * i nästa runda — och i den efter den. Ett svar som är dubbelt så stort kostar
 * alltså inte dubbelt utan kvadratiskt över en tur. Därför är det korta svaret
 * förval: nyckeltal och diagnostik, det som säger om ändringen blev bra.
 * Hela listan med maskiner, portar och zoner kostar sitt och hämtas när den
 * behövs, med get_current_layout.
 */
export function layoutSummary(
  config: Configuration,
  library: MachineLibrary = BUILTIN_LIBRARY,
  options: { full?: boolean } = {},
) {
  const layout = computeLayout(config, library);
  const brief = {
    totalLengthM: m(layout.metrics.totalLengthMm),
    totalWidthM: m(layout.metrics.totalWidthMm),
    footprintM2: layout.metrics.footprintM2,
    throughputPerHour: layout.metrics.throughputPerHour,
    bottleneck: layout.metrics.bottleneck?.name ?? null,
    totalPowerKw: layout.metrics.totalPowerKw,
    machineCount: layout.placements.length,
    drawnCount: config.drawn.length,
    diagnostics: layout.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      title: d.title,
    })),
    errorCount: layout.diagnostics.filter((d) => d.severity === "error").length,
    warningCount: layout.diagnostics.filter((d) => d.severity === "warning").length,
  };
  if (!options.full) return brief;

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
    drawn: drawnSummary(config),
    diagnostics: layout.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      title: d.title,
      detail: d.detail,
      hasSuggestedFix: !!d.fix,
    })),
    errorCount: brief.errorCount,
    warningCount: brief.warningCount,
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
        "Maskinernas grunddata står redan i systemprompten (MASKINBIBLIOTEK) — läs den " +
        "först. Det här verktyget ger samma lista i maskinläsbar form, filtrerad på " +
        "kategori, och är till för när du vill vara säker på ett id eller en siffra. " +
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
          outPortId: {
            type: "string",
            description:
              "Utgång linjen fortsätter ur, för maskiner med flera. Id:na står i " +
              "maskinbiblioteket. Utelämna för maskinens förval.",
          },
          branchFromInstanceId: {
            type: "string",
            description:
              "Starta en gren på en maskin som redan står i linjen, i stället för att " +
              "lägga maskinen sist i kedjan. Ange maskinens instanceId. Kräver " +
              "branchOutPortId. Använd detta när flödet delar sig.",
          },
          branchOutPortId: {
            type: "string",
            description:
              "Utgången på branchFromInstanceId som grenen utgår ur. Måste vara ledig — " +
              "en utgång kan bara mata en maskin.",
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
      name: "clear_line",
      description:
        "Tömmer arbetskopians linje på maskiner. Använd när du ska bygga upp en linje " +
        "från grunden, t.ex. efter en flödesbild kunden laddat upp, så att du slipper " +
        "ta bort maskinerna en och en. Rör inte hallen eller det som är ritat.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "draw_hall",
      description:
        "Ritar upp lokalen i arbetskopian: hallens mått, väggar, portar, truckzoner och " +
        "no-go-zoner. Väggarna anges som mittlinjer mellan två punkter — verktyget ger " +
        "dem tjocklek, rätar dem till närmaste axel och stänger hörnen där de möts. " +
        "Portar anges som en punkt med bredd och sätts in i väggen de ligger närmast.\n\n" +
        "Koordinater i meter från hallens nedre vänstra hörn: X längs hallen, Y tvärs. " +
        "Alla mått är meter.\n\n" +
        "Skalan ska vara belagd: ange scaleSource och scaleNote med det du skalade efter — " +
        "ett måttsatt mått på ritningen, en skalstock, eller ett mått kunden uppgett. " +
        "Saknas allt det ritas hallen ändå, men svaret markeras som obelagt och du måste " +
        "säga det till kunden och tala om vilket mått du behöver.",
      input_schema: {
        type: "object" as const,
        properties: {
          lengthM: {
            type: "number",
            description: "Hallens längd i meter, 5–300. Utelämna för att behålla nuvarande.",
          },
          widthM: {
            type: "number",
            description: "Hallens bredd i meter, 5–150. Utelämna för att behålla nuvarande.",
          },
          clearHeightM: {
            type: "number",
            description: "Fri höjd i meter, 2–30. Utelämna för att behålla nuvarande.",
          },
          scaleSource: {
            type: "string",
            enum: ["dimension_on_drawing", "scale_bar", "stated_by_customer"],
            description:
              "Var skalan kommer ifrån: måttsatt mått på ritningen, skalstock, eller " +
              "uppgift från kunden.",
          },
          scaleNote: {
            type: "string",
            description:
              "Måttet du skalade efter, ordagrant som det står på ritningen: " +
              "\"15m längs långsidan\", \"måttkedjan 48 000 mm mot söder\", " +
              "\"kunden uppgav 21 m mellan gavlarna\". Har ritningen flera mått: " +
              "skriv det du utgick från och att de andra stämde mot det. " +
              "Kunden ska kunna kontrollera din utgångspunkt.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "Sant tar bort det som redan är ritat innan de nya objekten läggs in. " +
              "Använd sant när du ritar upp en hel lokal, falskt när du kompletterar.",
          },
          walls: {
            type: "array",
            description: "Väggarnas mittlinjer.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                fromXM: { type: "number" },
                fromYM: { type: "number" },
                toXM: { type: "number" },
                toYM: { type: "number" },
              },
              required: ["fromXM", "fromYM", "toXM", "toYM"],
              additionalProperties: false,
            },
          },
          doors: {
            type: "array",
            description: "Portar: mittpunkt och bredd. Sätts in i närmaste vägg.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                xM: { type: "number" },
                yM: { type: "number" },
                widthM: { type: "number" },
              },
              required: ["xM", "yM", "widthM"],
              additionalProperties: false,
            },
          },
          areas: {
            type: "array",
            description:
              "Ytor: truckzon (truck) eller spärrad yta (nogo), som rektanglar. " +
              "Pelare, maskingropar och upplag ritas som nogo.",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["truck", "nogo"] },
                name: { type: "string" },
                xM: { type: "number" },
                yM: { type: "number" },
                lengthM: { type: "number" },
                widthM: { type: "number" },
              },
              required: ["kind", "xM", "yM", "lengthM", "widthM"],
              additionalProperties: false,
            },
          },
        },
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
      /*
       * Kort form. Allt det här står redan i systemprompten, som är cachad och
       * betalas en gång — det här svaret följer med i varje efterföljande
       * runda och kostar därför om och om igen.
       */
      return ctx.library.machines
        .filter((machine) => !category || machine.category === category)
        .map((machine) => ({
          id: machine.id,
          name: machine.name,
          category: machine.category,
          aux: !!machine.aux,
          lengthM: machine.footprint.lengthMm / 1000,
          widthM: machine.footprint.widthMm / 1000,
          capacityPerHour: machine.capacity.packagesPerHour,
          variants: machine.variants?.map((v) => v.id),
          outPorts: machine.ports.filter((p) => p.role === "out").map((p) => p.id),
          requires: machine.requires?.length ? machine.requires : undefined,
        }));
    }

    case "get_current_layout":
      return layoutSummary(ctx.draft, ctx.library, { full: true });

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

      const outs = machine.ports.filter((p) => p.role === "out");
      if (input.outPortId) {
        const wanted = String(input.outPortId);
        if (!outs.some((p) => p.id === wanted)) {
          return {
            error:
              `Okänd utgång: ${wanted}. ${machine.name} har ` +
              `${outs.map((p) => `${p.id} (${p.name ?? p.id})`).join(", ")}.`,
          };
        }
        item.outPortId = wanted;
      }

      /*
       * Grenen kopplas till en maskin som redan står i linjen. Allt kontrolleras
       * mot biblioteket och mot linjen: en gren på en maskin som inte finns, på
       * en ingång, eller på en utgång som redan matar något annat är inte en
       * gren utan en trasig konfiguration.
       */
      let branchIndex: number | null = null;
      if (input.branchFromInstanceId) {
        const fromId = String(input.branchFromInstanceId);
        const parent = ctx.draft.line.find((i) => i.instanceId === fromId);
        if (!parent) {
          return { error: `Ingen maskin med instanceId ${fromId} finns i linjen.` };
        }
        const parentMachine = getMachine(parent.machineId, ctx.library);
        if (!parentMachine) {
          return { error: `Maskinen ${parent.machineId} finns inte i biblioteket.` };
        }
        const parentOuts = parentMachine.ports.filter((p) => p.role === "out");
        const portId = input.branchOutPortId
          ? String(input.branchOutPortId)
          : (parentOuts.find((p) => !usedOutPorts(ctx.draft.line, fromId, parentMachine).has(p.id))?.id ??
             parentOuts[0]?.id);
        if (!portId || !parentOuts.some((p) => p.id === portId)) {
          return {
            error:
              `Okänd utgång: ${input.branchOutPortId}. ${parentMachine.name} har ` +
              `${parentOuts.map((p) => `${p.id} (${p.name ?? p.id})`).join(", ")}.`,
          };
        }
        const used = usedOutPorts(ctx.draft.line, fromId, parentMachine);
        if (used.has(portId)) {
          return {
            error:
              `Utgången ${portId} på ${parentMachine.name} matar redan en maskin. ` +
              `Lediga utgångar: ${parentOuts.filter((p) => !used.has(p.id)).map((p) => p.id).join(", ") || "inga"}.`,
          };
        }
        item.branch = { fromInstanceId: fromId, outPortId: portId };
        branchIndex = segmentEndIndex(ctx.draft.line, fromId);
      }

      const at =
        typeof input.atIndex === "number"
          ? input.atIndex
          : (branchIndex ?? ctx.draft.line.length);
      ctx.draft.line.splice(
        Math.max(0, Math.min(ctx.draft.line.length, at)),
        0,
        item,
      );
      return {
        added: {
          instanceId: item.instanceId,
          machineId,
          variantId: item.variantId,
          outPortId: item.outPortId,
          branch: item.branch,
        },
        layout: layoutSummary(ctx.draft, ctx.library),
      };
    }

    case "remove_machine": {
      const instanceId = String(input.instanceId);
      const before = ctx.draft.line;
      if (!before.some((i) => i.instanceId === instanceId)) {
        return {
          error: `Ingen maskin med instanceId ${instanceId} finns i linjen.`,
        };
      }
      // Grenar som hänger på maskinen följer med, precis som i gränssnittet:
      // en gren utan fäste går inte att placera.
      ctx.draft.line = removeWithBranches(before, instanceId);
      const alsoRemoved = before
        .filter((i) => !ctx.draft.line.some((k) => k.instanceId === i.instanceId))
        .map((i) => i.instanceId)
        .filter((id) => id !== instanceId);
      return {
        removed: instanceId,
        alsoRemoved,
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

    case "clear_line": {
      const removed = ctx.draft.line.length;
      ctx.draft.line = [];
      return { removed, layout: layoutSummary(ctx.draft, ctx.library) };
    }

    case "draw_hall": {
      /*
       * Skalan ska vara belagd, men kravet får inte bli en vägg.
       *
       * Först vägrade verktyget rita utan scaleNote. En modell som inte fyller
       * i fältet — och det gör inte alla — svarade då med exakt samma anrop om
       * och om igen, och kunden fick ingenting. Det var att skydda måttet på
       * bekostnad av hela ritningen.
       *
       * Nu ritas den, och avsaknaden av belägg följer med ut som en varning
       * ända fram till kunden. Ett omätt underlag som syns är bättre än ett
       * uteblivet svar.
       */
      const note = String(input.scaleNote ?? "").trim();
      const source = typeof input.scaleSource === "string" ? input.scaleSource : null;
      const scaleVerified = !!note && !!source;

      if (typeof input.lengthM === "number") {
        ctx.draft.hall.lengthMm = clamp(Math.round(input.lengthM * 1000), 5000, 300_000);
      }
      if (typeof input.widthM === "number") {
        ctx.draft.hall.widthMm = clamp(Math.round(input.widthM * 1000), 5000, 150_000);
      }
      if (typeof input.clearHeightM === "number") {
        ctx.draft.hall.clearHeightMm = clamp(Math.round(input.clearHeightM * 1000), 2000, 30_000);
      }

      const mm = (value: unknown) => Math.round(Number(value) * 1000);
      const walls = (input.walls as Record<string, unknown>[] | undefined) ?? [];
      const doors = (input.doors as Record<string, unknown>[] | undefined) ?? [];
      const areas = (input.areas as Record<string, unknown>[] | undefined) ?? [];
      const finite = (...values: number[]) => values.every((v) => Number.isFinite(v));

      const plan: Plan = {
        walls: walls
          .map((w) => ({
            name: typeof w.name === "string" ? w.name : undefined,
            from: { x: mm(w.fromXM), y: mm(w.fromYM) },
            to: { x: mm(w.toXM), y: mm(w.toYM) },
          }))
          .filter((w) => finite(w.from.x, w.from.y, w.to.x, w.to.y)),
        doors: doors
          .map((d) => ({
            name: typeof d.name === "string" ? d.name : undefined,
            at: { x: mm(d.xM), y: mm(d.yM) },
            widthMm: mm(d.widthM),
          }))
          .filter((d) => finite(d.at.x, d.at.y, d.widthMm)),
        areas: areas
          .map((a) => ({
            kind: a.kind === "truck" ? ("truck" as const) : ("nogo" as const),
            name: typeof a.name === "string" ? a.name : undefined,
            box: { x: mm(a.xM), y: mm(a.yM), l: mm(a.lengthM), w: mm(a.widthM) },
          }))
          .filter((a) => finite(a.box.x, a.box.y, a.box.l, a.box.w)),
      };

      ctx.scaleVerified = scaleVerified;
      if (input.replaceExisting === true) ctx.draft.drawn = [];
      const { drawn, notes } = planToDrawn(plan, ctx.draft.hall, ctx.draft.drawn);
      ctx.draft.drawn = [...ctx.draft.drawn, ...drawn].slice(0, MAX_DRAWN);

      return {
        hall: ctx.draft.hall,
        added: drawn.length,
        notes,
        scale: { source, note, verified: scaleVerified },
        reminder: scaleVerified
          ? "Ritningen är uppmätt ur en bild. Säg det till kunden och be dem kontrollmäta " +
            "mot underlaget innan den används som beslutsunderlag."
          : "OBS: du angav inte var skalan kommer ifrån (scaleSource och scaleNote), så " +
            "måtten är obelagda. Ritningen är gjord ändå. Skriv i ditt svar och i förslagets " +
            "beskrivning att skalan är gissad och vilket mått kunden behöver lämna för att " +
            "den ska bli riktig. Anropa inte draw_hall igen bara för att fylla i fälten.",
        layout: layoutSummary(ctx.draft, ctx.library),
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
      const summary = layoutSummary(variant.config, ctx.library, { full: true });
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
