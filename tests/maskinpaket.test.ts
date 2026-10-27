import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { machineSchema } from "@/lib/machineSchema";

/**
 * Maskinpaket in i repot.
 *
 * Konverteringen har redan sitt test i pipeline.test.ts; det som prövas här
 * är steget efter — att ett färdigt paket hamnar rätt, att ett halvfärdigt
 * stoppas, och att ingenting skrivs när något är fel. Det är den delen som
 * rör filer man inte får ha sönder: biblioteket och modellmappen.
 */

const SCRIPT = "scripts/maskinpaket.mjs";

/** Ett repo att skriva till, med en riktig kopia av biblioteket. */
function fakeRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "repo-"));
  mkdirSync(path.join(repo, "data"), { recursive: true });
  cpSync("data/library.json", path.join(repo, "data", "library.json"));
  return repo;
}

/** Ett paket som ett riktigt, ifyllt sådant. */
function paket(overrides: Record<string, unknown> = {}): string {
  const rot = mkdtempSync(path.join(tmpdir(), "paket-"));
  const maskin = {
    id: "provbana",
    sku: "PB-1",
    name: "Provbana",
    category: "transport",
    summary: "",
    footprint: { lengthMm: 6000, widthMm: 1200, heightMm: 900 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 600 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 6000, y: 600 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: false,
    zones: [],
    capacity: {
      packagesPerHour: 20,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 0, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 0 },
    leadTimeWeeks: 0,
    options: [],
    model: { glb: "/models/provbana.glb", upAxis: "y", yawDeg: 270 },
    dimensionsVerified: false,
    ...overrides,
  };
  const id = String(maskin.id);
  const mapp = path.join(rot, id);
  mkdirSync(mapp, { recursive: true });
  writeFileSync(
    path.join(mapp, "maskin.json"),
    JSON.stringify(maskin, null, 2),
  );
  writeFileSync(path.join(mapp, `${id}.glb`), "glTF-platshållare");
  return rot;
}

function kor(args: string[]): string {
  return execFileSync("node", [SCRIPT, ...args], { encoding: "utf-8" });
}

const biblioteket = (repo: string) =>
  JSON.parse(readFileSync(path.join(repo, "data", "library.json"), "utf-8"));

describe("maskinpaket --installera", () => {
  it("lägger maskinen, modellen och ett pris på plats", () => {
    const repo = fakeRepo();
    const fore = biblioteket(repo).machines.length;
    kor([paket(), "--installera", "--repo", repo]);

    const doc = biblioteket(repo);
    const maskin = doc.machines.find(
      (m: { id: string }) => m.id === "provbana",
    );
    expect(doc.machines).toHaveLength(fore + 1);
    expect(maskin.name).toBe("Provbana");
    // Adressen är repots, inte paketets.
    expect(maskin.model.glb).toBe("/models/provbana.glb");
    expect(existsSync(path.join(repo, "public/models/provbana.glb"))).toBe(
      true,
    );
    /*
     * Ett nollpris, inte inget pris: prisräkningen hoppar tyst över en maskin
     * som saknar post, och då står den i ritningen men inte i offerten.
     */
    expect(doc.priceBook.entries.provbana).toEqual({
      list: 0,
      cost: 0,
      options: {},
    });
  });

  it("rör inte en maskin som redan finns utan --ersatt", () => {
    const repo = fakeRepo();
    const källa = paket();
    kor([källa, "--installera", "--repo", repo]);
    const fore = JSON.stringify(biblioteket(repo));

    const ut = kor([källa, "--installera", "--repo", repo]);
    expect(ut).toMatch(/finns redan/);
    expect(JSON.stringify(biblioteket(repo))).toBe(fore);

    kor([källa, "--installera", "--ersatt", "--repo", repo]);
    const doc = biblioteket(repo);
    // Ersatt, inte tillagd en gång till.
    expect(
      doc.machines.filter((m: { id: string }) => m.id === "provbana"),
    ).toHaveLength(1);
  });

  it("vägrar installera en maskinpost som schemat underkänner", () => {
    const repo = fakeRepo();
    const fore = readFileSync(path.join(repo, "data", "library.json"), "utf-8");
    // 80 mm lång är ingen maskin, och det är precis vad en felvänd eller
    // felskalad STEP ger.
    const ut = kor([
      paket({ footprint: { lengthMm: 80, widthMm: 1200, heightMm: 900 } }),
      "--installera",
      "--repo",
      repo,
    ]);

    expect(ut).toMatch(/SCHEMAFEL/);
    expect(ut).toMatch(/godkänns inte av schemat/);
    expect(readFileSync(path.join(repo, "data", "library.json"), "utf-8")).toBe(
      fore,
    );
    expect(existsSync(path.join(repo, "public/models/provbana.glb"))).toBe(
      false,
    );
  });

  it("skriver ett bibliotek som fortfarande går att läsa in", () => {
    const repo = fakeRepo();
    kor([paket(), "--installera", "--repo", repo]);
    for (const maskin of biblioteket(repo).machines) {
      expect(machineSchema.safeParse(maskin).success).toBe(true);
    }
  });
});
