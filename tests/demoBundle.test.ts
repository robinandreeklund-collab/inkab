import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createZip, crc32 } from "@/lib/zip";
import {
  bundleEntries,
  bundleFileName,
  demoBundleReadme,
  planDemoBundle,
  referencedModelIds,
} from "@/lib/demoBundle";
import { BUILTIN_MACHINES } from "@/lib/library";
import { BUILTIN_PRICE_BOOK } from "@/lib/server/pricebook";
import { libraryDocumentSchema, type LibraryDocument } from "@/lib/machineSchema";
import { putModel, readModel } from "@/lib/server/store";
import type { Machine } from "@/lib/types";

/**
 * Demo-paketet ska gå att packa upp i ett repo och committa. Två saker måste
 * därför stämma: arkivet måste vara ett riktigt ZIP-arkiv, och biblioteket i
 * det måste peka på filerna som ligger bredvid — inte på ett serverminne som
 * inte finns kvar efter omstarten.
 */

/** Läser arkivet via den centrala katalogen, precis som en uppackare gör. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);

  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = zip.readUInt16LE(cursor + 10);
    const crc = zip.readUInt32LE(cursor + 16);
    const compressed = zip.readUInt32LE(cursor + 20);
    const uncompressed = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const offset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf-8");

    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    const localName = zip.readUInt16LE(offset + 26);
    const localExtra = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const body = zip.subarray(start, start + compressed);
    const data = method === 0 ? body : inflateRawSync(body);

    expect(data.length).toBe(uncompressed);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

const glb = (byte: number, size = 2048): Uint8Array => {
  const data = new Uint8Array(size).fill(byte);
  data.set([0x67, 0x6c, 0x54, 0x46], 0); // "glTF"
  return data;
};

describe("createZip", () => {
  it("skriver ett arkiv som går att packa upp", async () => {
    const text = "# Rubrik\nÅäö och en rad till.\n".repeat(40);
    const binary = glb(7, 5000);
    const zip = await readZip(await createZip([
      { path: "LASMIG.md", data: text },
      { path: "public/models/ett.glb", data: binary },
    ]));

    expect([...zip.keys()]).toEqual(["LASMIG.md", "public/models/ett.glb"]);
    expect(zip.get("LASMIG.md")!.toString("utf-8")).toBe(text);
    expect(new Uint8Array(zip.get("public/models/ett.glb")!)).toEqual(binary);
  });

  it("klarar tomma filer och namn med åäö", async () => {
    const zip = await readZip(await createZip([{ path: "tömd-fil.txt", data: "" }]));
    expect(zip.get("tömd-fil.txt")!.length).toBe(0);
  });

  it("lagrar rått när deflate inte vinner något", async () => {
    // Slumpdata går inte att komprimera; arkivet ska inte bli större av försöket.
    const noise = new Uint8Array(4096).map((_, i) => (i * 2654435761) % 256);
    const zip = await createZip([{ path: "brus.bin", data: noise }]);
    expect(zip.length).toBeLessThan(noise.length + 200);
    expect(new Uint8Array(readZip(zip).get("brus.bin")!)).toEqual(noise);
  });
});

function documentWith(machines: Machine[]): LibraryDocument {
  return {
    machines,
    priceBook: JSON.parse(JSON.stringify(BUILTIN_PRICE_BOOK)),
    assets: [],
  };
}

function machineWithModel(id: string, model: { glb: string; proxy?: string }): Machine {
  const base = JSON.parse(JSON.stringify(BUILTIN_MACHINES[0])) as Machine;
  // Beroendena pekar på maskiner som inte är med i provbiblioteket.
  return { ...base, id, name: `Maskin ${id}`, model, requires: undefined, conflictsWith: undefined };
}

describe("planDemoBundle", () => {
  it("skriver om uppladdade modeller till repofiler", () => {
    const doc = documentWith([
      machineWithModel("tsl-enkel", { glb: "/api/models/abc123", proxy: "/api/models/abc123-proxy" }),
    ]);

    const plan = planDemoBundle(doc, new Set(["abc123", "abc123-proxy"]));

    expect(plan.files).toEqual([
      { path: "public/models/tsl-enkel.glb", modelId: "abc123" },
      { path: "public/models/tsl-enkel.proxy.glb", modelId: "abc123-proxy" },
    ]);
    expect(plan.document.machines[0].model).toMatchObject({
      glb: "/models/tsl-enkel.glb",
      proxy: "/models/tsl-enkel.proxy.glb",
    });
    expect(plan.missing).toEqual([]);
    // Dokumentet som kom in ska vara orört — rutten svarar, den sparar inte.
    expect(doc.machines[0].model?.glb).toBe("/api/models/abc123");
  });

  it("lämnar sökvägar som redan pekar på repot i fred", () => {
    const doc = documentWith([machineWithModel("tsl-enkel", { glb: "/models/tsl-enkel.glb" })]);
    const plan = planDemoBundle(doc, new Set());

    expect(plan.files).toEqual([]);
    expect(plan.alreadyInRepo).toBe(1);
    expect(plan.document.machines[0].model?.glb).toBe("/models/tsl-enkel.glb");
  });

  it("ger varianter egna filnamn och delar en modell som sitter på två maskiner", () => {
    const withVariant = machineWithModel("tsl-enkel", { glb: "/api/models/huvud" });
    withVariant.variants = [
      {
        id: "lång",
        name: "Lång",
        footprint: { lengthMm: 8000, widthMm: 2400, heightMm: 1200 },
        model: { glb: "/api/models/lang" },
      },
    ];
    const doc = documentWith([withVariant, machineWithModel("tsl-dubbel", { glb: "/api/models/huvud" })]);

    const plan = planDemoBundle(doc, new Set(["huvud", "lang"]));

    expect(plan.files.map((f) => f.path)).toEqual([
      "public/models/tsl-enkel.glb",
      "public/models/tsl-enkel-lang.glb",
    ]);
    expect(plan.document.machines[1].model?.glb).toBe("/models/tsl-enkel.glb");
    expect(plan.document.machines[0].variants?.[0].model?.glb).toBe("/models/tsl-enkel-lang.glb");
  });

  it("rapporterar modeller som fallit ur minnet och rör inte deras sökväg", () => {
    const doc = documentWith([machineWithModel("tsl-enkel", { glb: "/api/models/borta" })]);
    const plan = planDemoBundle(doc, new Set());

    expect(plan.files).toEqual([]);
    expect(plan.missing).toEqual([
      { modelId: "borta", machineId: "tsl-enkel", where: "Maskin tsl-enkel" },
    ]);
    expect(plan.document.machines[0].model?.glb).toBe("/api/models/borta");
    expect(demoBundleReadme(plan, new Map(), new Date())).toContain("Maskin tsl-enkel");
  });

  it("ger ett dokument som fortfarande går igenom schemat", () => {
    const doc = documentWith([machineWithModel("tsl-enkel", { glb: "/api/models/abc" })]);
    const plan = planDemoBundle(doc, new Set(["abc"]));
    expect(libraryDocumentSchema.safeParse(plan.document).success).toBe(true);
  });
});

describe("produktbilderna", () => {
  it("följer med i biblioteksfilen utan att röras", () => {
    // Bilderna ligger som base64 i dokumentet, inte som egna filer — de behöver
    // ingen omskrivning, bara att någon kontrollerar att de faktiskt är med.
    const machine = machineWithModel("tsl-enkel", { glb: "/api/models/abc" });
    machine.images = ["tsl-enkel-1"];
    const doc = documentWith([machine]);
    doc.assets = [
      {
        id: "tsl-enkel-1",
        machineId: "tsl-enkel",
        name: "framifran.webp",
        mime: "image/webp",
        data: Buffer.from("en bild, låtsas").toString("base64"),
      },
    ];

    const plan = planDemoBundle(doc, new Set(["abc"]));

    // Bilden ska ut som en fil, och maskinen ska peka på filen.
    expect(plan.images).toHaveLength(1);
    expect(plan.images[0].path).toBe("public/bilder/tsl-enkel-1.webp");
    expect(plan.images[0].base64).toBe(doc.assets[0].data);
    expect(plan.document.machines[0].images).toEqual(["/bilder/tsl-enkel-1.webp"]);
    // Och då ska den inte ligga kvar som base64 i biblioteksfilen också.
    expect(plan.document.assets).toEqual([]);
    expect(demoBundleReadme(plan, new Map(), new Date())).toContain("public/bilder/");
  });
});

describe("referencedModelIds", () => {
  it("hittar id:n på maskiner och varianter, en gång var", () => {
    const machine = machineWithModel("tsl-enkel", { glb: "/api/models/a", proxy: "/api/models/b" });
    machine.variants = [
      {
        id: "v",
        name: "V",
        footprint: { lengthMm: 8000, widthMm: 2400, heightMm: 1200 },
        model: { glb: "/api/models/a" },
      },
    ];
    const doc = documentWith([machine, machineWithModel("tsl-dubbel", { glb: "/models/statisk.glb" })]);

    expect(referencedModelIds(doc).sort()).toEqual(["a", "b"]);
  });
});

describe("paketet från början till slut", () => {
  it("packar modellerna ur lagret och biblioteket som pekar på dem", async () => {
    // Samma väg som en server utan DATABASE_URL tar: modellen i minnet.
    await putModel({
      id: "paket-1",
      machineId: "tsl-enkel",
      name: "tsl-enkel.step",
      kind: "glb",
      data: glb(3),
    });

    const withImage = machineWithModel("tsl-enkel", { glb: "/api/models/paket-1" });
    withImage.images = ["tsl-enkel-1"];
    const doc = documentWith([withImage]);
    doc.assets = [
      {
        id: "tsl-enkel-1",
        machineId: "tsl-enkel",
        name: "framifran.webp",
        mime: "image/webp",
        data: Buffer.from(new Uint8Array(600).fill(9)).toString("base64"),
      },
    ];
    const ids = referencedModelIds(doc);
    const loaded = new Map<string, Buffer>();
    for (const id of ids) {
      const model = await readModel(id);
      if (model) loaded.set(id, model.data);
    }

    const plan = planDemoBundle(doc, new Set(loaded.keys()));
    const now = new Date("2026-09-15T08:00:00Z");
    // Samma funktion som rutten bygger arkivet med.
    const zip = await createZip(bundleEntries(plan, loaded, now), now);

    const files = readZip(zip);
    expect([...files.keys()]).toEqual([
      "LASMIG.md",
      "data/library.json",
      "public/models/tsl-enkel.glb",
      "public/bilder/tsl-enkel-1.webp",
    ]);

    const library = JSON.parse(files.get("data/library.json")!.toString("utf-8"));
    expect(library.machines[0].model.glb).toBe("/models/tsl-enkel.glb");
    // Bilden ska ligga i arkivet som en fil, med exakt samma byte som laddades
    // upp, och maskinen ska peka på den.
    expect(library.machines[0].images).toEqual(["/bilder/tsl-enkel-1.webp"]);
    expect(files.get("public/bilder/tsl-enkel-1.webp")).toEqual(
      Buffer.from(doc.assets[0].data, "base64"),
    );
    expect(library.assets).toEqual([]);
    // Sökvägen i biblioteket ska peka på en fil som faktiskt ligger i arkivet.
    expect(files.has(`public${library.machines[0].model.glb}`)).toBe(true);
    expect(files.get("public/models/tsl-enkel.glb")!.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(bundleFileName(now)).toBe("inkab-demo-2026-09-15.zip");
  });
});
