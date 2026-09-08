"use client";

import { useState } from "react";
import Image from "next/image";
import { useConfigStore } from "@/store/useConfigStore";
import { meters, mkr, sek, todayISO } from "@/lib/format";
import { quoteReference, validUntil } from "@/lib/quote";
import { COMPANY } from "@/lib/company";
import { QuotePlan } from "./QuotePlan";
import { Button, Tag } from "./ui";
import type { SessionUser } from "./AuthDialog";
import type { PriceResult, Role } from "@/lib/server/pricing";

/**
 * Offertunderlaget.
 *
 * Skrivs ut till PDF med webbläsarens utskrift, så det är byggt som ett
 * dokument och inte som en skärmvy: A4, ett titelblock som säger vem som
 * skickat vad och när, planritningen först, och en sidfot som följer med på
 * varje sida. Innehållet flyter över sidkanterna i stället för att brytas på
 * bestämda ställen — rubriker, rader och ritningen hålls hela, resten fyller
 * pappret.
 *
 * Underlagsnumret räknas ur konfigurationen. Ändras linjen ändras numret —
 * ett papper och en anläggning kan alltså inte glida isär i tysthet.
 */
export function QuoteView({
  price,
  role,
  user,
}: {
  price: PriceResult | null;
  role: Role;
  user: SessionUser | null;
}) {
  const { config, layout, setScreen, update } = useConfigStore();
  const metrics = layout.metrics;
  const errors = layout.diagnostics.filter((d) => d.severity === "error");
  const warnings = layout.diagnostics.filter((d) => d.severity === "warning");

  const reference = quoteReference(config);
  const today = todayISO();
  const expires = price?.validUntil ?? validUntil();

  const setCustomer = (patch: Partial<NonNullable<typeof config.customer>>) =>
    update((draft) => {
      draft.customer = { ...draft.customer, ...patch };
    });

  return (
    <div className="scroll-thin h-full overflow-y-auto bg-paper print:overflow-visible print:bg-white">
      <Toolbar
        reference={reference}
        onBack={() => setScreen("configurator")}
        config={config}
        layout={layout}
        price={price}
        role={role}
      />

      <article className="quote mx-auto max-w-[210mm] bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {/*
          * Sidfoten upprepas på varje utskriven sida. En fast positionerad
          * ruta duger inte: Chrome klipper bort det som hamnar i marginalen
          * och lägger den annars ovanpå texten. En tfoot reserverar däremot
          * sin plats på varje sida, vilket är hela poängen. På skärmen är
          * tabellen utlagd som vanliga block och märks inte.
          */}
        <table className="quote-sheet w-full">
          <tfoot>
            <tr>
              <td>
                <div className="hidden border-t border-divider pt-1 text-[10px] text-muted print:block">
                  {COMPANY.legalName} · {COMPANY.town} ·{" "}
                  <span className="whitespace-nowrap">{COMPANY.phone}</span> · {COMPANY.web} —
                  Underlag {reference}, {today}. Prisindikation, ej bindande offert.
                </div>
              </td>
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td>
        <header className="mb-6 flex items-start gap-6 border-b-2 border-ink pb-4">
          <div className="shrink-0 bg-ink px-3 py-2">
            <Image src="/inkab-logo.png" alt="INKAB" width={153} height={32} className="h-8 w-auto" />
          </div>
          <div className="flex-1">
            <div className="kicker">Offertunderlag · utkast</div>
            <h1 className="text-2xl leading-tight">{config.projectName}</h1>
            <p className="text-xs text-muted">
              {COMPANY.legalName} · {COMPANY.town} ·{" "}
              <span className="whitespace-nowrap">{COMPANY.phone}</span>
            </p>
          </div>
          <dl className="shrink-0 text-right text-xs">
            <Meta label="Underlag" value={reference} mono />
            <Meta label="Datum" value={today} mono />
            <Meta label="Prisindikation t.o.m." value={expires} mono />
            {user ? <Meta label="Framtaget av" value={user.name || user.email} /> : null}
          </dl>
        </header>

        <section className="mb-6 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <Party title="Kund">
            <EditableLine
              label="Företag"
              value={config.customer?.company ?? ""}
              placeholder={user?.company || "Kundens företag"}
              onChange={(v) => setCustomer({ company: v })}
            />
            <EditableLine
              label="Kontakt"
              value={config.customer?.contact ?? ""}
              placeholder="Namn hos kunden"
              onChange={(v) => setCustomer({ contact: v })}
            />
            <EditableLine
              label="Anläggning"
              value={config.customer?.site ?? ""}
              placeholder="Ort eller sågverk"
              onChange={(v) => setCustomer({ site: v })}
            />
            <EditableLine
              label="Er referens"
              value={config.customer?.reference ?? ""}
              placeholder="Kundens eget projektnummer"
              onChange={(v) => setCustomer({ reference: v })}
            />
          </Party>

          <Party title="Sammanfattning">
            <Line label="Totalmått" value={`${meters(metrics.totalLengthMm)} × ${meters(metrics.totalWidthMm)} m`} />
            <Line label="Golvyta inkl. gångar" value={`${metrics.footprintM2} m²`} />
            <Line
              label="Kapacitet"
              value={metrics.throughputPerHour > 0 ? `${metrics.throughputPerHour} pkt/h` : "—"}
            />
            <Line
              label={price?.totals ? "Listpris" : "Prisintervall"}
              value={
                price?.totals
                  ? mkr(price.totals.grandTotal)
                  : price
                    ? `${mkr(price.indication.lowSek)}–${mkr(price.indication.highSek)}`
                    : "—"
              }
            />
          </Party>
        </section>

        {errors.length > 0 || warnings.length > 0 ? (
          <Callout tone={errors.length > 0 ? "danger" : "warn"}>
            <strong>
              {errors.length > 0
                ? `${errors.length} olöst ${errors.length === 1 ? "fel" : "fel"} i layouten`
                : `${warnings.length} ${warnings.length === 1 ? "varning" : "varningar"}`}
              .
            </strong>{" "}
            Underlaget går att ta fram ändå, men{" "}
            {errors.length > 0
              ? "felen måste lösas innan anläggningen kan byggas"
              : "punkterna bör gås igenom med konstruktör"}
            : {[...errors, ...warnings].map((d) => d.code).join(", ")}.
          </Callout>
        ) : null}

        <Section title="Planritning" note={`Skala enligt skalstock · ${reference}`}>
          <QuotePlan config={config} layout={layout} />
        </Section>

        <Section title="Maskinlista" flow>
          <table className="w-full text-sm">
            <thead className="table-header-group">
              <tr className="border-b border-ink text-left">
                <Th>Pos</Th>
                <Th>Benämning</Th>
                <Th>Artikel</Th>
                <Th>Mått l × b × h</Th>
                <Th>Optioner</Th>
                <Th align="right">Antal</Th>
                {role !== "guest" ? <Th align="right">Radpris</Th> : null}
              </tr>
            </thead>
            <tbody>
              {(price?.lines ?? []).map((line) => {
                const placement = layout.placements.find((p) => p.instanceId === line.instanceId);
                return (
                  <tr key={line.instanceId} className="break-inside-avoid border-b border-divider">
                    <Td>{line.pos}</Td>
                    <Td>{line.name}</Td>
                    <Td muted>{line.sku}</Td>
                    <Td muted>
                      {placement
                        ? `${meters(placement.size.lengthMm)} × ${meters(placement.size.widthMm)} × ${meters(placement.size.heightMm)} m`
                        : "—"}
                    </Td>
                    <Td muted>{line.optionNames.join(", ") || "—"}</Td>
                    <Td align="right">{line.quantity}</Td>
                    {role !== "guest" ? (
                      <Td align="right">{line.rowTotal != null ? `${sek(line.rowTotal)} kr` : "—"}</Td>
                    ) : null}
                  </tr>
                );
              })}
              {(price?.lines ?? []).length === 0 ? (
                <tr>
                  <Td>—</Td>
                  <Td>Linjen är tom</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  {role !== "guest" ? <Td>—</Td> : null}
                </tr>
              ) : null}
            </tbody>
          </table>

          {price?.totals ? (
            <div className="mt-3 ml-auto w-full max-w-xs space-y-1 break-inside-avoid text-sm">
              <Total label="Maskiner" value={price.totals.machines} />
              <Total label="Montage" value={price.totals.install} />
              <Total label="El och styr" value={price.totals.control} />
              <Total label="Frakt" value={price.totals.freight} />
              <div className="flex justify-between border-t border-ink pt-1 font-medium">
                <span>Summa exkl. moms</span>
                <span className="num">{sek(price.totals.grandTotal)} kr</span>
              </div>
              <div className="no-print flex justify-between text-xs text-muted">
                <span>Marginal (visas ej för kund)</span>
                <span className="num">
                  {sek(price.totals.margin)} kr · {price.totals.marginPercent} %
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">
              {price?.note ??
                "Logga in för att se listpriser. Utan inloggning visas bara ett intervall."}
            </p>
          )}
        </Section>

        <div className="grid gap-6 md:grid-cols-2">
          <Section title="Tekniska förutsättningar">
            <dl className="text-sm">
              <Line label="Elmatning" value={`${metrics.totalPowerKw} kW · 3×400 V`} />
              <Line
                label="Tryckluft"
                value={metrics.totalAirNlPerMin > 0 ? `${metrics.totalAirNlPerMin} Nl/min · 6 bar` : "Ingen"}
              />
              <Line label="Gropar" value={metrics.pitCount > 0 ? `${metrics.pitCount} st` : "Inga"} />
              <Line label="Fri takhöjd" value={`≥ ${meters(metrics.maxHeightMm + 800)} m`} />
              <Line label="Hall" value={`${meters(config.hall.lengthMm)} × ${meters(config.hall.widthMm)} m`} />
              <Line label="Leveranstid" value={`${metrics.leadTimeWeeks} veckor`} />
              <Line
                label="Flaskhals"
                value={metrics.bottleneck ? metrics.bottleneck.name : "Ingen identifierad"}
              />
            </dl>
          </Section>

          <Section title="Flöde och konfiguration">
            <dl className="text-sm">
              <Line label="Paketen kommer in" value={infeedLabel(config.flow.infeedFrom)} />
              <Line label="Pulpetens sida" value={sideLabel(config.flow.controlDeskSide)} />
              <Line label="Ströfacksmagasin" value={sideLabel(config.flow.stickerMagazineSide)} />
              <Line label="Trucken hämtar från" value={sideLabel(config.flow.truckPickupSide)} />
              <Line
                label="Sista kedjetransportör"
                value={`${meters(config.flow.finalConveyorLengthMm)} m`}
              />
              <Line
                label="Virkesbredd"
                value={`${meters(config.product.packageWidthMinMm)}–${meters(config.product.packageWidthMaxMm)} m`}
              />
              <Line
                label="Paket"
                value={`${meters(config.product.packageLengthMm)} × ${meters(config.product.packageHeightMm)} m, ${config.product.packageWeightKg} kg`}
              />
            </dl>
          </Section>
        </div>


        <Section title="Antaganden och avgränsningar" badge={<Tag tone="accent">Utkast</Tag>}>
          <ul className="ml-4 list-disc text-sm leading-relaxed">
            <li>
              Plant betonggolv med minst 25 kN/m² bärighet, och att befintlig linje lämnar paket
              på 900 mm höjd.
            </li>
            <li>
              {truckSummary(config)} Truckgator och hämtzoner är de kunden ritat in; ingen är
              antagen åt er.
            </li>
            <li>
              Måtten kommer ur maskinbiblioteket.{" "}
              {unverifiedCount(layout) > 0
                ? `${unverifiedCount(layout)} av ${layout.placements.length} maskiner har uppskattade mått som inte är kontrollerade mot ritning.`
                : "Samtliga ingående maskiner har kontrollerade mått."}
            </li>
            <li>
              Elprojektering, riskanalys, hallmätning, fundamentritningar och byggnadsarbeten
              ingår inte.
            </li>
            <li>Priser är exklusive moms och gäller leverans fritt vår fabrik om inget annat avtalas.</li>
          </ul>
          <p className="mt-3 border-t border-divider pt-2 text-xs text-muted">
            Underlaget är genererat ur konfiguratorn och är en prisindikation, inte en bindande
            offert. Det granskas av säljare innan utskick. Frågor: {COMPANY.phone}.
          </p>
        </Section>

              </td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}

/* ── Verktygsrad ───────────────────────────────────────────────────────── */

function Toolbar({
  reference,
  onBack,
  config,
  layout,
  price,
  role,
}: {
  reference: string;
  onBack: () => void;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  layout: ReturnType<typeof useConfigStore.getState>["layout"];
  price: PriceResult | null;
  role: Role;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (kind: "csv" | "dxf") => {
    setBusy(kind);
    const { machineListCsv, planDxf, download, exportName } = await import("@/lib/export");
    if (kind === "csv") {
      download(
        exportName(reference, config.projectName, "csv"),
        machineListCsv(config, layout, price, role),
        "text/csv",
      );
    } else {
      download(
        exportName(reference, config.projectName, "dxf"),
        planDxf(config, layout),
        "application/dxf",
      );
    }
    setBusy(null);
  };

  return (
    <div className="no-print sticky top-0 z-10 border-b border-divider bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-2 px-8 py-3">
        <Button onClick={onBack}>Tillbaka till vyn</Button>
        <span className="num text-xs text-muted">{reference}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => run("csv")} disabled={busy !== null}>
            Maskinlista (CSV)
          </Button>
          <Button onClick={() => run("dxf")} disabled={busy !== null}>
            Planritning (DXF)
          </Button>
          <Button disabled title="Kräver inloggning och nedladdningslogg">
            STEP-filer
          </Button>
          <Button variant="primary" onClick={() => window.print()}>
            Skriv ut / spara som PDF
          </Button>
        </div>
      </div>
      <p className="mx-auto max-w-[210mm] px-8 pb-2 text-[11px] leading-relaxed text-muted">
        Utskriften är satt för A4. DXF:en öppnas i AutoCAD, BricsCAD och LibreCAD med
        maskiner, hall, truckgator och maskinzoner på egna lager, i millimeter.
      </p>
    </div>
  );
}

/* ── Byggstenar ────────────────────────────────────────────────────────── */

function Section({
  title,
  badge,
  note,
  flow,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  note?: string;
  /** Får brytas över en sidkant. Sant för allt som kan bli långt. */
  flow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`mb-6 ${flow ? "" : "break-inside-avoid"}`}>
      <div className="mb-2 flex items-baseline gap-2 border-b border-divider pb-1">
        <h2 className="kicker">{title}</h2>
        {badge}
        {note ? <span className="num ml-auto text-[10px] text-muted">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Party({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="kicker mb-1 border-b border-divider pb-1">{title}</div>
      <dl>{children}</dl>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={mono ? "num" : ""}>{value}</dd>
    </div>
  );
}

/**
 * Fält som går att fylla i på skärmen och som skrivs ut som text. Ett tomt
 * fält skrivs ut som en linje att fylla i för hand — bättre än en fejkad
 * uppgift, och bättre än ett hål i dokumentet.
 */
function EditableLine({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-divider py-1 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1">
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="quote-input w-full border-0 bg-transparent px-1 py-0 text-right text-sm outline-none placeholder:text-muted/60 focus:bg-paper"
        />
      </dd>
    </div>
  );
}

function Callout({ tone, children }: { tone: "danger" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={`mb-6 break-inside-avoid border-l-2 py-1 pl-3 text-sm leading-relaxed ${
        tone === "danger" ? "border-danger" : "border-warn"
      }`}
    >
      {children}
    </p>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return <th className={`kicker py-1.5 ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}

function Td({
  children,
  muted,
  align,
}: {
  children: React.ReactNode;
  muted?: boolean;
  align?: "right";
}) {
  return (
    <td
      className={`py-1.5 align-top ${muted ? "text-muted" : ""} ${align === "right" ? "num text-right" : ""}`}
    >
      {children}
    </td>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-divider py-1 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="num">{sek(value)} kr</span>
    </div>
  );
}

/* ── Text ur konfigurationen ───────────────────────────────────────────── */

function infeedLabel(value: string): string {
  return { straight: "Rakt", right: "Från höger", left: "Från vänster" }[value] ?? value;
}

function sideLabel(value: string): string {
  return value === "right" ? "Höger" : "Vänster";
}

function truckSummary(config: ReturnType<typeof useConfigStore.getState>["config"]): string {
  const aisles = config.drawn.filter((d) => d.kind === "truck");
  if (aisles.length === 0) {
    return "Ingen truckgata är inritad — trucktrafiken är alltså inte prövad mot layouten.";
  }
  const widest = Math.min(...aisles.map((a) => Math.min(a.l, a.w)));
  return `${aisles.length} ${aisles.length === 1 ? "truckyta" : "truckytor"} inritade, smalaste fria bredd ${meters(widest)} m.`;
}

function unverifiedCount(layout: ReturnType<typeof useConfigStore.getState>["layout"]): number {
  return layout.placements.filter((p) => p.machine.dimensionsVerified !== true).length;
}
