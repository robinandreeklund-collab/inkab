import { describe, expect, it } from "vitest";
import { runReport, usageTotals } from "@/lib/runReport";

/**
 * Rapporten som ska gå att klistra in i ett mejl.
 *
 * Den ska svara på två frågor utan följdfrågor: var tog tiden vägen, och var
 * tog tokenen vägen. Klarar den inte det är den bara ett kvitto på att något
 * gick långsamt.
 */

const job = {
  id: "job-abc",
  status: "done",
  createdAt: "2026-09-09T10:00:00.000Z",
  updatedAt: "2026-09-09T10:06:24.000Z",
  note: "Hallen är 15 m lång.",
  fileNames: ["ritning.pdf"],
  summary: "Jag ritade upp lokalen efter måttet 15 m.",
  error: null,
  variantCount: 1,
  detail: {
    model: "grok-4",
    provider: "grok",
    rounds: 3,
    stopReason: "answered",
    steps: [
      { name: "get_machine_library", ok: true, ms: 4 },
      { name: "draw_hall", ok: false, ms: 2, error: "scaleNote måste säga vad du skalade efter." },
      { name: "propose_variant", ok: true, ms: 9 },
    ],
    timeline: [
      { round: 1, modelMs: 180_000, toolMs: 4, tools: 1, usage: { input: 9000, output: 400, cacheRead: 0, cacheWrite: 9000 } },
      { round: 2, modelMs: 120_000, toolMs: 2, tools: 1, usage: { input: 900, output: 700, cacheRead: 9000, cacheWrite: 0 } },
      { round: 3, modelMs: 84_000, toolMs: 9, tools: 1, usage: { input: 1200, output: 500, cacheRead: 10_000, cacheWrite: 0 } },
    ],
    totalMs: 384_000,
  },
};

describe("usageTotals", () => {
  it("summerar tid och token över rundorna", () => {
    const totals = usageTotals(job.detail.timeline);
    expect(totals.input).toBe(11_100);
    expect(totals.output).toBe(1600);
    expect(totals.cacheRead).toBe(19_000);
    expect(totals.modelMs).toBe(384_000);
    expect(totals.toolMs).toBe(15);
  });
});

describe("runReport", () => {
  const text = runReport(job);

  it("säger vilken modell som körde och hur länge", () => {
    expect(text).toContain("grok-4");
    expect(text).toContain("384.0 s");
  });

  it("visar att tiden gick till modellen och inte till verktygen", () => {
    // Verktygen tog 15 ms av sex minuter. Det ska gå att se på en rad.
    expect(text).toContain("modell 384.0 s, verktyg 0.0 s");
  });

  it("har en rad per runda med tid och token", () => {
    expect(text).toContain("Runda  Modell");
    expect(text).toMatch(/1\s+180\.0 s/);
    expect(text).toContain("SUMMA");
  });

  it("tar med verktygens felsvar ordagrant", () => {
    expect(text).toContain("FEL  draw_hall");
    expect(text).toContain("scaleNote måste säga vad du skalade efter.");
  });

  it("tar med underlaget och kundens egna ord", () => {
    expect(text).toContain("ritning.pdf");
    expect(text).toContain("Hallen är 15 m lång.");
  });

  it("klarar en körning utan siffror alls", () => {
    const bare = runReport({
      id: "job-tom",
      status: "failed",
      createdAt: "2026-09-09T10:00:00.000Z",
      updatedAt: "2026-09-09T10:00:02.000Z",
      error: "Nyckeln avvisades (401).",
    });
    expect(bare).toContain("Modell: okänd");
    expect(bare).toContain("Nyckeln avvisades");
  });
});
