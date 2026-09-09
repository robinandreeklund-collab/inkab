import { describe, expect, it } from "vitest";
import { toolDefinitions, executeTool, type ToolContext } from "@/lib/ai/tools";
import { BUILTIN_LIBRARY, BUILTIN_MACHINES, makeLibrary } from "@/lib/library";
import { defaultConfig } from "@/lib/templates";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import type { Configuration, Machine } from "@/lib/types";

/**
 * Med strict: true accepterar Messages API bara en delmängd av JSON Schema.
 * Numeriska och stränglängdsbegränsningar avvisas med 400 vid anropet — alltså
 * först i produktion, med riktig nyckel. Testet fångar det i stället.
 */
const FORBIDDEN = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
];

/** Alla nycklar i ett schema, rekursivt, med sin sökväg. */
function walk(node: unknown, path: string[] = []): { path: string; key: string }[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => walk(item, [...path, String(i)]));
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) => [
      { path: [...path, key].join("."), key },
      ...walk(value, [...path, key]),
    ]);
  }
  return [];
}

function context(config: Configuration, library = BUILTIN_LIBRARY): ToolContext {
  return {
    original: JSON.parse(JSON.stringify(config)),
    draft: JSON.parse(JSON.stringify(config)),
    variants: [],
    role: "guest",
    library,
    priceBook: BUILTIN_PRICE_BOOK,
  };
}

describe("verktygsscheman", () => {
  const tools = toolDefinitions();

  it("använder inga nyckelord som strict-läget avvisar", () => {
    for (const tool of tools) {
      const found = walk(tool.input_schema)
        .filter((entry) => FORBIDDEN.includes(entry.key))
        .map((entry) => `${tool.name}: ${entry.path}`);
      expect(found, found.join(", ")).toHaveLength(0);
    }
  });

  it("varje objekt har additionalProperties: false och required", () => {
    for (const tool of tools) {
      expect(tool.input_schema.additionalProperties, tool.name).toBe(false);
      expect(Array.isArray(tool.input_schema.required), tool.name).toBe(true);
    }
  });

  it("alla verktyg är strikta och unikt namngivna", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of tools) expect(tool.strict, tool.name).toBe(true);
  });

  it("maskin-enumet följer biblioteket", () => {
    const addMachine = tools.find((t) => t.name === "add_machine")!;
    const machineId = addMachine.input_schema.properties.machineId as { enum: string[] };
    expect(machineId.enum).toEqual(BUILTIN_LIBRARY.machines.map((m) => m.id));
  });
});

describe("serverklippning ersätter schemats intervall", () => {
  it("klipper sista transportörens längd", () => {
    const ctx = context(defaultConfig());
    executeTool("set_flow", { finalConveyorLengthMm: 999_999 }, ctx);
    expect(ctx.draft.flow.finalConveyorLengthMm).toBe(40_000);

    executeTool("set_flow", { finalConveyorLengthMm: 10 }, ctx);
    expect(ctx.draft.flow.finalConveyorLengthMm).toBe(1000);
  });

  it("klipper hallens mått", () => {
    const ctx = context(defaultConfig());
    executeTool("set_hall", { lengthMm: 9_000_000, widthMm: 1, clearHeightMm: 99_000 }, ctx);
    expect(ctx.draft.hall.lengthMm).toBe(300_000);
    expect(ctx.draft.hall.widthMm).toBe(5000);
    expect(ctx.draft.hall.clearHeightMm).toBe(30_000);
  });

  it("klipper insättningspositionen i stället för att kasta", () => {
    const config = defaultConfig();
    const ctx = context(config);
    const before = ctx.draft.line.length;
    executeTool("add_machine", { machineId: "rullbana", atIndex: 9999 }, ctx);
    expect(ctx.draft.line).toHaveLength(before + 1);
    expect(ctx.draft.line[before].machineId).toBe("rullbana");

    executeTool("add_machine", { machineId: "rullbana", atIndex: -5 }, ctx);
    expect(ctx.draft.line[0].machineId).toBe("rullbana");
  });

  it("avvisar okänd maskin med ett fel modellen kan läsa", () => {
    const ctx = context(defaultConfig());
    const result = executeTool("add_machine", { machineId: "finns-inte" }, ctx) as {
      error?: string;
    };
    expect(result.error).toContain("Okänd maskin");
  });
});

/**
 * Att läsa en uppladdad ritning och rita upp lokalen.
 *
 * Verktyget måste vara lika strängt som en människa borde vara: en ritning
 * utan känd skala går inte att mäta, och allt som justerades ska tillbaka
 * till assistenten i klartext så att kunden får veta det.
 */
describe("draw_hall", () => {
  it("sätter hallens mått och ritar väggar, portar och zoner", () => {
    const ctx = context(defaultConfig());
    const result = executeTool(
      "draw_hall",
      {
        lengthM: 50,
        widthM: 24,
        scaleSource: "dimension_on_drawing",
        scaleNote: "Måttkedjan 50 000 mm längs södra ytterväggen.",
        replaceExisting: true,
        walls: [
          { name: "Södra", fromXM: 0, fromYM: 0, toXM: 50, toYM: 0 },
          { name: "Östra", fromXM: 50, fromYM: 0, toXM: 50, toYM: 24 },
        ],
        doors: [{ name: "Port A", xM: 12, yM: 0, widthM: 4 }],
        areas: [{ kind: "nogo", name: "Pelare", xM: 20, yM: 12, lengthM: 0.8, widthM: 0.8 }],
      },
      ctx,
    ) as { added: number; notes: string[] };

    expect(ctx.draft.hall.lengthMm).toBe(50_000);
    expect(ctx.draft.hall.widthMm).toBe(24_000);
    expect(result.added).toBe(4);
    expect(ctx.draft.drawn.map((d) => d.kind)).toEqual(["wall", "wall", "nogo", "door"]);

    // Porten sitter i väggen, inte bredvid den.
    const door = ctx.draft.drawn.find((d) => d.kind === "door")!;
    const wall = ctx.draft.drawn.find((d) => d.kind === "wall")!;
    expect(door.y).toBe(wall.y);
    expect(door.w).toBe(wall.w);
  });

  it("markerar skalan som obelagd när anteckningen är tom", () => {
    // Verktyget vägrade förr rita utan anteckning. En modell som inte fyllde i
    // fältet gjorde då om samma anrop tills rundorna tog slut, och kunden fick
    // ingenting — måttet skyddades på bekostnad av hela ritningen.
    const ctx = context(defaultConfig());
    const result = executeTool(
      "draw_hall",
      {
        scaleSource: "dimension_on_drawing",
        scaleNote: "   ",
        walls: [{ fromXM: 0, fromYM: 0, toXM: 20, toYM: 0 }],
      },
      ctx,
    ) as { error?: string; scale: { verified: boolean }; added: number };
    expect(result.error).toBeUndefined();
    expect(result.scale.verified).toBe(false);
    expect(result.added).toBe(1);
  });

  it("påminner om att en uppmätt bild ska kontrollmätas", () => {
    const ctx = context(defaultConfig());
    const result = executeTool(
      "draw_hall",
      {
        scaleSource: "stated_by_customer",
        scaleNote: "Kunden uppgav 46 m mellan gavlarna.",
        walls: [{ fromXM: 0, fromYM: 0, toXM: 40, toYM: 0 }],
      },
      ctx,
    ) as { reminder: string };
    expect(result.reminder).toContain("kontrollmäta");
  });

  it("kompletterar i stället för att sudda när replaceExisting inte är satt", () => {
    const ctx = context(defaultConfig());
    const draw = (name: string) =>
      executeTool(
        "draw_hall",
        {
          scaleSource: "scale_bar",
          scaleNote: "Skalstock 1:100.",
          walls: [{ name, fromXM: 0, fromYM: 0, toXM: 30, toYM: 0 }],
        },
        ctx,
      );
    draw("Första");
    draw("Andra");
    const walls = () => ctx.draft.drawn.filter((d) => d.kind === "wall").map((d) => d.name);
    expect(walls()).toEqual(["Första", "Andra"]);
    // Det som redan låg i konfigurationen står kvar.
    expect(ctx.draft.drawn.length).toBeGreaterThan(2);

    executeTool(
      "draw_hall",
      {
        scaleSource: "scale_bar",
        scaleNote: "Skalstock 1:100.",
        replaceExisting: true,
        walls: [{ name: "Enda", fromXM: 0, fromYM: 0, toXM: 30, toYM: 0 }],
      },
      ctx,
    );
    expect(ctx.draft.drawn.map((d) => d.name)).toEqual(["Enda"]);
    expect(walls()).toEqual(["Enda"]);
  });

  it("lämnar tillbaka det som justerades i stället för att rätta tyst", () => {
    const ctx = context(defaultConfig());
    const result = executeTool(
      "draw_hall",
      {
        lengthM: 40,
        widthM: 20,
        scaleSource: "dimension_on_drawing",
        scaleNote: "Måttsatt 40 000 mm.",
        walls: [
          { fromXM: 0, fromYM: 0, toXM: 39, toYM: 1.2 },
          { fromXM: 0, fromYM: 60, toXM: 30, toYM: 60 },
        ],
      },
      ctx,
    ) as { notes: string[] };
    expect(result.notes.join(" ")).toContain("snett");
    expect(result.notes.join(" ")).toContain("utanför hallens mått");
  });
});

/** Linjen byggd efter en flödesbild: tömma, fylla på, och grena. */
describe("clear_line och grenar", () => {
  const base = BUILTIN_MACHINES.find((m) => m.id === "rullbana-underslag")!;
  const twoWay: Machine = {
    ...base,
    id: "delare",
    ports: [
      { ...base.ports[0], id: "in", role: "in", pos: { x: 0, y: 1000 }, dir: "x+" },
      { ...base.ports[1], id: "ut", name: "Rakt fram", role: "out", pos: { x: 6000, y: 1000 }, dir: "x+" },
      {
        ...base.ports[1],
        id: "ut-sida",
        name: "Ut på kortsidan",
        role: "out",
        pos: { x: 3000, y: 2000 },
        dir: "y+",
        allowsDirectionChange: true,
      },
    ],
  };
  const library = makeLibrary([...BUILTIN_MACHINES, twoWay]);

  it("tömmer linjen utan att röra hallen eller det ritade", () => {
    const ctx = context(defaultConfig());
    ctx.draft.drawn = [
      { id: "w", kind: "wall", name: "Vägg 1", x: 0, y: 0, l: 1000, w: 300, h: 3000 },
    ];
    const hall = { ...ctx.draft.hall };
    const result = executeTool("clear_line", {}, ctx) as { removed: number };
    expect(result.removed).toBeGreaterThan(0);
    expect(ctx.draft.line).toHaveLength(0);
    expect(ctx.draft.drawn).toHaveLength(1);
    expect(ctx.draft.hall).toEqual(hall);
  });

  it("lägger en maskin på en ledig utgång som en gren", () => {
    const config = defaultConfig();
    const ctx = context(config, library);
    executeTool("clear_line", {}, ctx);
    const first = executeTool("add_machine", { machineId: "delare" }, ctx) as {
      added: { instanceId: string };
    };
    executeTool("add_machine", { machineId: "rullbana" }, ctx);

    const branch = executeTool(
      "add_machine",
      {
        machineId: "rullbana",
        branchFromInstanceId: first.added.instanceId,
        branchOutPortId: "ut-sida",
      },
      ctx,
    ) as { added: { branch?: { fromInstanceId: string; outPortId: string } } };

    expect(branch.added.branch).toEqual({
      fromInstanceId: first.added.instanceId,
      outPortId: "ut-sida",
    });
  });

  it("vägrar hänga två maskiner på samma utgång", () => {
    const ctx = context(defaultConfig(), library);
    executeTool("clear_line", {}, ctx);
    const first = executeTool("add_machine", { machineId: "delare" }, ctx) as {
      added: { instanceId: string };
    };
    executeTool(
      "add_machine",
      { machineId: "rullbana", branchFromInstanceId: first.added.instanceId, branchOutPortId: "ut-sida" },
      ctx,
    );
    const again = executeTool(
      "add_machine",
      { machineId: "rullbana", branchFromInstanceId: first.added.instanceId, branchOutPortId: "ut-sida" },
      ctx,
    ) as { error?: string };
    expect(again.error).toContain("matar redan");
  });

  it("avvisar en gren på en maskin som inte står i linjen", () => {
    const ctx = context(defaultConfig(), library);
    const result = executeTool(
      "add_machine",
      { machineId: "rullbana", branchFromInstanceId: "finns-inte", branchOutPortId: "ut" },
      ctx,
    ) as { error?: string };
    expect(result.error).toContain("finns-inte");
  });

  it("avvisar en utgång maskinen inte har", () => {
    const ctx = context(defaultConfig(), library);
    executeTool("clear_line", {}, ctx);
    const first = executeTool("add_machine", { machineId: "delare" }, ctx) as {
      added: { instanceId: string };
    };
    const result = executeTool(
      "add_machine",
      { machineId: "rullbana", branchFromInstanceId: first.added.instanceId, branchOutPortId: "bakut" },
      ctx,
    ) as { error?: string };
    expect(result.error).toContain("Okänd utgång");
  });
});

describe("remove_machine", () => {
  it("tar med grenen när maskinen den hänger på försvinner", () => {
    const base = BUILTIN_MACHINES.find((m) => m.id === "rullbana-underslag")!;
    const twoWay: Machine = {
      ...base,
      id: "delare",
      ports: [
        { ...base.ports[0], id: "in", role: "in", pos: { x: 0, y: 1000 }, dir: "x+" },
        { ...base.ports[1], id: "ut", role: "out", pos: { x: 6000, y: 1000 }, dir: "x+" },
        {
          ...base.ports[1],
          id: "ut-sida",
          role: "out",
          pos: { x: 3000, y: 2000 },
          dir: "y+",
          allowsDirectionChange: true,
        },
      ],
    };
    const ctx = context(defaultConfig(), makeLibrary([...BUILTIN_MACHINES, twoWay]));
    executeTool("clear_line", {}, ctx);
    const parent = executeTool("add_machine", { machineId: "delare" }, ctx) as {
      added: { instanceId: string };
    };
    const branch = executeTool(
      "add_machine",
      {
        machineId: "rullbana",
        branchFromInstanceId: parent.added.instanceId,
        branchOutPortId: "ut-sida",
      },
      ctx,
    ) as { added: { instanceId: string } };

    const result = executeTool(
      "remove_machine",
      { instanceId: parent.added.instanceId },
      ctx,
    ) as { alsoRemoved: string[] };

    expect(result.alsoRemoved).toContain(branch.added.instanceId);
    expect(ctx.draft.line).toHaveLength(0);
  });
});

describe("draw_hall utan belagd skala", () => {
  const PLAN = {
    lengthM: 15,
    widthM: 10,
    replaceExisting: true,
    walls: [
      { fromXM: 0, fromYM: 0, toXM: 15, toYM: 0 },
      { fromXM: 15, fromYM: 0, toXM: 15, toYM: 10 },
    ],
  };

  it("ritar ändå, men säger att måtten är obelagda", () => {
    const ctx = context(defaultConfig());
    const result = executeTool("draw_hall", PLAN, ctx) as {
      added: number;
      scale: { verified: boolean };
      reminder: string;
      error?: string;
    };

    // Att vägra rita gjorde att modeller utan strikt schema körde fast i samma
    // anrop om och om igen, och kunden fick ingenting alls.
    expect(result.error).toBeUndefined();
    expect(result.added).toBe(2);
    expect(result.scale.verified).toBe(false);
    expect(result.reminder).toContain("obelagda");
    expect(result.reminder).toContain("Anropa inte draw_hall igen");
    expect(ctx.draft.hall.lengthMm).toBe(15_000);
  });

  it("räknar skalan som belagd när både källa och anteckning finns", () => {
    const ctx = context(defaultConfig());
    const result = executeTool(
      "draw_hall",
      { ...PLAN, scaleSource: "dimension_on_drawing", scaleNote: "Måttkedjan 15 000 mm." },
      ctx,
    ) as { scale: { verified: boolean; note: string }; reminder: string };

    expect(result.scale.verified).toBe(true);
    expect(result.scale.note).toContain("15 000");
    expect(result.reminder).toContain("kontrollmäta");
  });

  it("kräver inte längre skalfälten i schemat", () => {
    // Schemat måste stämma med vad servern faktiskt gör: ett krav som bara
    // står i schemat och inte hålls av mottagaren är en fälla.
    const drawHall = toolDefinitions().find((t) => t.name === "draw_hall")!;
    expect(drawHall.input_schema.required).toEqual([]);
  });
});

describe("skalflaggan följer med ut ur körningen", () => {
  it("sätts till falskt när hallen ritades utan belagd skala", () => {
    const ctx = context(defaultConfig());
    expect(ctx.scaleVerified).toBeUndefined();
    executeTool(
      "draw_hall",
      { lengthM: 15, widthM: 10, walls: [{ fromXM: 0, fromYM: 0, toXM: 15, toYM: 0 }] },
      ctx,
    );
    expect(ctx.scaleVerified).toBe(false);
  });

  it("sätts till sant när måttet är angivet", () => {
    const ctx = context(defaultConfig());
    executeTool(
      "draw_hall",
      {
        lengthM: 15,
        widthM: 10,
        scaleSource: "dimension_on_drawing",
        scaleNote: "15m längs långsidan",
        walls: [{ fromXM: 0, fromYM: 0, toXM: 15, toYM: 0 }],
      },
      ctx,
    );
    expect(ctx.scaleVerified).toBe(true);
  });
});

describe("propose_variant säger ifrån om tomma förslag", () => {
  it("varnar när förslaget saknar maskiner", () => {
    const config = defaultConfig();
    const ctx = context(config);
    executeTool("clear_line", {}, ctx);
    const result = executeTool(
      "propose_variant",
      { name: "Lokalen", description: "Bara hallen." },
      ctx,
    ) as { warnings?: string[] };
    expect(result.warnings?.join(" ")).toContain("inga maskiner");
  });

  it("varnar när förslaget är kundens egen konfiguration", () => {
    const ctx = context(defaultConfig());
    const result = executeTool(
      "propose_variant",
      { name: "Oförändrat", description: "Samma som förut." },
      ctx,
    ) as { warnings?: string[] };
    expect(result.warnings?.join(" ")).toContain("identiskt");
  });

  it("varnar inte om ett riktigt förslag", () => {
    const ctx = context(defaultConfig());
    executeTool("add_machine", { machineId: "rullbana" }, ctx);
    const result = executeTool(
      "propose_variant",
      { name: "Med rullbana", description: "En rullbana till." },
      ctx,
    ) as { warnings?: string[] };
    expect(result.warnings).toBeUndefined();
  });
});

describe("skalan räknas som belagd av måttet, inte av kategorin", () => {
  it("räcker med scaleNote", () => {
    const ctx = context(defaultConfig());
    const result = executeTool(
      "draw_hall",
      {
        lengthM: 15,
        widthM: 9,
        scaleNote: "15 m längs överkant, 9 m nederkant",
        walls: [{ fromXM: 0, fromYM: 0, toXM: 15, toYM: 0 }],
      },
      ctx,
    ) as { scale: { verified: boolean; source: string | null } };

    // Att inte fylla i en kategori gör inte måttet mindre uppmätt.
    expect(result.scale.verified).toBe(true);
    expect(result.scale.source).toBe("dimension_on_drawing");
    expect(ctx.scaleVerified).toBe(true);
  });
});

describe("upprepade uppritningar av samma lokal", () => {
  it("säger ifrån från andra gången", () => {
    const ctx = context(defaultConfig());
    const plan = {
      lengthM: 15,
      widthM: 9,
      scaleNote: "15 m",
      replaceExisting: true,
      walls: [{ fromXM: 0, fromYM: 0, toXM: 15, toYM: 0 }],
    };
    const first = executeTool("draw_hall", plan, ctx) as { alreadyDrawn?: string };
    expect(first.alreadyDrawn).toBeUndefined();

    const second = executeTool("draw_hall", plan, ctx) as { alreadyDrawn?: string };
    // Fyra uppritningar av samma hall i en tur är fyra rundor för samma sak.
    expect(second.alreadyDrawn).toContain("2 gånger");
    expect(second.alreadyDrawn).toContain("ett enda anrop");
  });
});

describe("propose_variant när add_machine aldrig anropats", () => {
  it("säger att layouten är facit", () => {
    const ctx = context(defaultConfig());
    executeTool("clear_line", {}, ctx);
    const result = executeTool(
      "propose_variant",
      { name: "Lokalen", description: "Bara hallen." },
      ctx,
    ) as { warnings?: string[] };
    expect(result.warnings?.join(" ")).toContain("inte anropat add_machine");
    expect(result.warnings?.join(" ")).toContain("machineCount: 0");
  });

  it("nöjer sig med en kort varning när den faktiskt försökt", () => {
    const ctx = context(defaultConfig());
    executeTool("clear_line", {}, ctx);
    executeTool("add_machine", { machineId: "finns-inte" }, ctx);
    const result = executeTool(
      "propose_variant",
      { name: "Lokalen", description: "Bara hallen." },
      ctx,
    ) as { warnings?: string[] };
    expect(result.warnings?.join(" ")).toContain("inga maskiner");
    expect(result.warnings?.join(" ")).not.toContain("inte anropat add_machine");
  });
});

describe("draw_hall med ett tomt anrop", () => {
  it("svarar med fel i stället för att låtsas ha ritat", () => {
    // Ett tomt anrop svarade förr "klart, 0 objekt" — och dolde därmed att
    // argumenten aldrig kom fram.
    const result = executeTool("draw_hall", {}, context(defaultConfig())) as { error?: string };
    expect(result.error).toContain("ingenting att rita");
    expect(result.error).toContain("lengthM");
  });

  it("godtar ett anrop som bara sätter hallens mått", () => {
    const ctx = context(defaultConfig());
    const result = executeTool("draw_hall", { lengthM: 15, widthM: 9 }, ctx) as {
      error?: string;
    };
    expect(result.error).toBeUndefined();
    expect(ctx.draft.hall.lengthMm).toBe(15_000);
  });
});


/**
 * Taket på valfria parametrar.
 *
 * Anthropic kompilerar en grammatik ur verktygsschemana när strict är på, och
 * avvisar hela anropet med 400 om de valfria parametrarna är fler än 24 — inte
 * per verktyg utan tillsammans. Det märks först i produktion, med riktig
 * nyckel, som ett jobb som dör på en halv sekund.
 *
 * Det hände: när scaleSource och scaleNote gjordes valfria för att en annan
 * leverantör inte kunde fylla i dem hamnade summan på 26, och Claude slutade
 * fungera helt. Testet räknar dem i stället.
 */
describe("verktygsschemanas budget", () => {
  const LIMIT = 24;
  const HEADROOM = 21;

  function optionalPaths(node: unknown, path: string, found: string[]): void {
    if (Array.isArray(node)) {
      node.forEach((item) => optionalPaths(item, path, found));
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "object" && record.properties) {
      const required = new Set((record.required as string[] | undefined) ?? []);
      for (const key of Object.keys(record.properties as object)) {
        if (!required.has(key)) found.push(`${path}.${key}`);
      }
    }
    for (const [key, value] of Object.entries(record)) {
      optionalPaths(value, `${path}.${key}`, found);
    }
  }

  it("håller sig under Anthropics gräns, med marginal", () => {
    const found: string[] = [];
    for (const tool of toolDefinitions()) optionalPaths(tool.input_schema, tool.name, found);

    expect(found.length, found.join(", ")).toBeLessThan(LIMIT);
    // Marginalen är till för nästa fält som behöver läggas till: går det över
    // ska det märkas här och inte som ett 400 hos kunden.
    expect(found.length, `${found.length} valfria parametrar: ${found.join(", ")}`).toBeLessThanOrEqual(
      HEADROOM,
    );
  });
});

describe("skalans belägg över en hel tur", () => {
  const PLAN = {
    lengthM: 15,
    widthM: 9,
    walls: [{ fromXM: 0, fromYM: 0, toXM: 15, toYM: 0 }],
  };

  it("tar emot skalanoteringen i efterhand", () => {
    const ctx = context(defaultConfig());
    executeTool("draw_hall", PLAN, ctx);
    expect(ctx.scaleVerified).toBe(false);

    // Assistenten ritade först och kom på efteråt att den inte skrivit vad den
    // skalade efter. Det ska gå att komplettera utan att rita om.
    const result = executeTool(
      "draw_hall",
      { scaleNote: "15m längs långsidan, 9m på kortsidan" },
      ctx,
    ) as { error?: string; scale?: { verified: boolean } };

    expect(result.error).toBeUndefined();
    expect(result.scale?.verified).toBe(true);
    expect(ctx.scaleVerified).toBe(true);
  });

  it("glömmer inte ett belägg när lokalen ritas om", () => {
    const ctx = context(defaultConfig());
    executeTool("draw_hall", { ...PLAN, scaleNote: "15m längs långsidan" }, ctx);
    expect(ctx.scaleVerified).toBe(true);

    // Den sista uppritningen saknar noteringen. Måttet är inte ogjort för det.
    executeTool("draw_hall", PLAN, ctx);
    expect(ctx.scaleVerified).toBe(true);
  });

  it("avvisar fortfarande ett anrop utan både plan och notering", () => {
    const result = executeTool("draw_hall", {}, context(defaultConfig())) as { error?: string };
    expect(result.error).toContain("ingenting att rita");
  });

  it("avvisar en notering innan något ritats", () => {
    // Utan en ritning att sätta skalan på är noteringen bara en mening.
    const result = executeTool(
      "draw_hall",
      { scaleNote: "15m" },
      context(defaultConfig()),
    ) as { error?: string };
    expect(result.error).toContain("ingenting att rita");
  });
});
