import { describe, expect, it } from "vitest";
import { decodeConfig, encodeConfig, shareUrl } from "@/lib/share";
import { quoteReference, validUntil } from "@/lib/quote";
import { machineListCsv, planDxf, exportName } from "@/lib/export";
import { computeLayout } from "@/lib/layout";
import { templateConfig } from "@/lib/templates";
import type { Configuration } from "@/lib/types";

const config = templateConfig("strolinje");
const layout = computeLayout(config);

describe("delningslänk", () => {
  it("går igenom fram och tillbaka utan att tappa något", async () => {
    const result = await decodeConfig(await encodeConfig(config));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(config);
  });

  it("komprimerar — länken blir kortare än rå base64", async () => {
    const encoded = await encodeConfig(config);
    const raw = Buffer.from(JSON.stringify(config)).toString("base64");
    expect(encoded.startsWith("z.")).toBe(true);
    expect(encoded.length).toBeLessThan(raw.length);
  });

  it("läser fortfarande gamla okomprimerade länkar", async () => {
    // Formatet före komprimeringen. En länk som redan är utskickad ska
    // fortsätta fungera.
    const legacy = Buffer.from(JSON.stringify(config))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = await decodeConfig(legacy);
    expect(result.ok).toBe(true);
  });

  it("säger att en avhuggen länk inte gick att läsa", async () => {
    const encoded = await encodeConfig(config);
    const result = await decodeConfig(encoded.slice(0, encoded.length - 20));
    expect(result).toEqual({ ok: false, reason: "unreadable" });
  });

  it("säger att innehåll som inte är en konfiguration är ogiltigt", async () => {
    const bogus = Buffer.from(JSON.stringify({ version: 1, projectName: "" })).toString("base64url");
    const result = await decodeConfig(bogus);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("bygger en adress utan gamla parametrar", async () => {
    const { url, long } = await shareUrl(config, "https://inkab.nu", "/");
    expect(url.startsWith("https://inkab.nu/?c=z.")).toBe(true);
    expect(typeof long).toBe("boolean");
  });

  it("tar med kundfälten", async () => {
    const withCustomer: Configuration = {
      ...config,
      customer: { company: "Sågverket AB", reference: "P-2026-14" },
    };
    const result = await decodeConfig(await encodeConfig(withCustomer));
    expect(result.ok && result.config.customer?.reference).toBe("P-2026-14");
  });
});

describe("underlagsnummer", () => {
  it("är stabilt för samma konfiguration", () => {
    const date = new Date("2026-03-04");
    expect(quoteReference(config, date)).toBe(quoteReference(templateConfig("strolinje"), date));
  });

  it("ändras när linjen ändras", () => {
    const date = new Date("2026-03-04");
    const changed: Configuration = { ...config, line: config.line.slice(0, -1) };
    expect(quoteReference(changed, date)).not.toBe(quoteReference(config, date));
  });

  it("ändras inte av kundfält eller projektnamn", () => {
    // De står på pappret men ändrar ingen anläggning, så numret ska ligga still.
    const date = new Date("2026-03-04");
    const renamed: Configuration = {
      ...config,
      projectName: "Ett helt annat namn",
      customer: { company: "Sågverket AB" },
    };
    expect(quoteReference(renamed, date)).toBe(quoteReference(config, date));
  });

  it("har formen INKAB-ÅÅMM-XXXXX utan tecken som läses fel", () => {
    const reference = quoteReference(config, new Date("2026-03-04"));
    expect(reference).toMatch(/^INKAB-2603-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  });

  it("ger en giltighetsdag i framtiden", () => {
    expect(validUntil(new Date("2026-03-04"), 30)).toBe("2026-04-03");
  });
});

describe("export", () => {
  it("skriver en CSV som svensk Excel läser", () => {
    const csv = machineListCsv(config, layout, null, "guest");
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const [header] = csv.slice(1).split("\r\n");
    expect(header.split(";")[0]).toBe('"Pos"');
    // Gäst ska inte få en priskolumn ens som tom rubrik.
    expect(header).not.toContain("Radpris");
    expect(csv).toContain('"Projekt"');
  });

  it("skriver decimaltal med komma", () => {
    // Svensk Excel läser "2.2" som text, inte som ett tal.
    const csv = machineListCsv(config, layout, null, "guest");
    expect(csv).not.toMatch(/"\d+\.\d+"/);
    expect(csv).toMatch(/"\d+,\d+"/);
  });

  it("citerar fält som innehåller citattecken", () => {
    const named: Configuration = { ...config, projectName: 'Linje "A"' };
    expect(machineListCsv(named, layout, null, "guest")).toContain('"Linje ""A"""');
  });

  it("skriver en DXF med sektioner, lager och entiteter", () => {
    const dxf = planDxf(config, layout);
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("ENTITIES");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    for (const layer of ["HALL", "MASKIN", "MASKINZON", "FLODE"]) {
      expect(dxf).toContain(layer);
    }
    // Gruppkoder och värden ska komma parvis.
    const rows = dxf.trimEnd().split("\r\n");
    expect(rows.length % 2).toBe(0);
  });

  it("vänder Y-axeln så ritningen blir rättvänd i CAD", () => {
    // Världens Y pekar nedåt i planvyn, DXF:ens uppåt.
    const dxf = planDxf(config, layout);
    const rows = dxf.split("\r\n");
    const yValues = rows
      .map((row, i) => (row === "20" ? Number(rows[i + 1]) : null))
      .filter((v): v is number => v !== null && v !== 0);
    expect(yValues.length).toBeGreaterThan(0);
    expect(yValues.every((v) => v <= 0)).toBe(true);
  });

  it("namnger filen efter underlagsnumret", () => {
    expect(exportName("INKAB-2603-AB2CD", "Ströläggning Hjo", "dxf")).toBe(
      "INKAB-2603-AB2CD-strolaggning-hjo.dxf",
    );
  });
});
