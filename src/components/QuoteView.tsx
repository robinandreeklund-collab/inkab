"use client";

import { useState } from "react";
import Image from "next/image";
import { useConfigStore } from "@/store/useConfigStore";
import { adjustmentLabel } from "@/lib/quoteAdjustment";
import { meters, sek, todayISO } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { dimensionLength } from "@/lib/dimensions";
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
  const t = useT();
  const metrics = layout.metrics;
  /** Belopp på kundens språk: "1 234 kr", "SEK 1 234". */
  const money = (amount: number) => t("quote.money", { v: sek(amount) });
  const millions = (amount: number) =>
    t("quote.millions", { v: (amount / 1_000_000).toFixed(2).replace(".", ",") });
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
                  {t("quote.footer", { reference, today })}
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
            <div className="kicker">{t("quote.kicker")}</div>
            <h1 className="text-2xl leading-tight">{config.projectName}</h1>
            <p className="text-xs text-muted">
              {COMPANY.legalName} · {COMPANY.town} ·{" "}
              <span className="whitespace-nowrap">{COMPANY.phone}</span>
            </p>
          </div>
          <dl className="shrink-0 text-right text-xs">
            <Meta label={t("quote.reference")} value={reference} mono />
            <Meta label={t("quote.date")} value={today} mono />
            <Meta label={t("quote.validUntil")} value={expires} mono />
            {user ? <Meta label={t("quote.preparedBy")} value={user.name || user.email} /> : null}
          </dl>
        </header>

        <section className="mb-6 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <Party title={t("quote.customer")}>
            <EditableLine
              label={t("quote.company")}
              value={config.customer?.company ?? ""}
              placeholder={user?.company || t("quote.companyPlaceholder")}
              onChange={(v) => setCustomer({ company: v })}
            />
            <EditableLine
              label={t("quote.contact")}
              value={config.customer?.contact ?? ""}
              placeholder={t("quote.contactPlaceholder")}
              onChange={(v) => setCustomer({ contact: v })}
            />
            <EditableLine
              label={t("quote.site")}
              value={config.customer?.site ?? ""}
              placeholder={t("quote.sitePlaceholder")}
              onChange={(v) => setCustomer({ site: v })}
            />
            <EditableLine
              label={t("quote.yourReference")}
              value={config.customer?.reference ?? ""}
              placeholder={t("quote.yourReferencePlaceholder")}
              onChange={(v) => setCustomer({ reference: v })}
            />
          </Party>

          <Party title={t("quote.summary")}>
            <Line label={t("quote.totalSize")} value={`${meters(metrics.totalLengthMm)} × ${meters(metrics.totalWidthMm)} m`} />
            <Line label={t("quote.floorArea")} value={`${metrics.footprintM2} m²`} />
            <Line
              label={t("quote.capacity")}
              value={metrics.throughputPerHour > 0 ? t("quote.perHour", { count: metrics.throughputPerHour }) : "—"}
            />
            <Line
              label={price?.adjustment?.fixedTotalSek ? t("quote.agreedPrice") : t("quote.price")}
              value={
                price?.totals
                  ? millions(price.totals.grandTotal)
                  : price?.indication
                    ? `${millions(price.indication.lowSek)}–${millions(price.indication.highSek)}`
                    : t("quote.priceByInkab")
              }
            />
          </Party>
        </section>

        {errors.length > 0 || warnings.length > 0 ? (
          <Callout tone={errors.length > 0 ? "danger" : "warn"}>
            <strong>
              {errors.length > 0 && warnings.length > 0
                ? t("quote.issuesBoth", { errors: errors.length, warnings: warnings.length })
                : errors.length > 0
                  ? t("quote.issuesErrors", { errors: errors.length })
                  : t(warnings.length === 1 ? "quote.issuesWarning" : "quote.issuesWarnings", {
                      warnings: warnings.length,
                    })}
            </strong>{" "}
            {errors.length > 0 ? t("quote.issuesMustFix") : t("quote.issuesReview")}{" "}
            {/* En rad per regel, inte en kod per anmärkning: "R-103 ×8" säger mer än åtta likadana koder. */}
            {groupByCode([...errors, ...warnings])
              .map(({ code, title, count }) => `${title} (${code}${count > 1 ? ` ×${count}` : ""})`)
              .join(", ")}
            .
          </Callout>
        ) : null}

        <Section title={t("quote.plan")} note={t("quote.planNote", { reference })}>
          <QuotePlan config={config} layout={layout} />
        </Section>

        <Section title={t("quote.machineList")} flow>
          <table className="w-full text-sm">
            <thead className="table-header-group">
              <tr className="border-b border-ink text-left">
                <Th>{t("quote.col.pos")}</Th>
                <Th>{t("quote.col.name")}</Th>
                <Th>{t("quote.col.sku")}</Th>
                <Th>{t("quote.col.size")}</Th>
                <Th>{t("quote.col.options")}</Th>
                <Th align="right">{t("quote.col.qty")}</Th>
                {role !== "guest" ? <Th align="right">{t("quote.col.rowPrice")}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {(price?.lines ?? []).map((line) => {
                const placement = layout.placements.find((p) => p.instanceId === line.instanceId);
                return (
                  <tr key={line.instanceId} className="break-inside-avoid border-b border-divider">
                    <Td>{line.pos}</Td>
                    <Td>
                      {line.name}
                      {/* Kundens egen anteckning om maskinen, om den skrivit en. */}
                      {line.note ? (
                        <span className="mt-0.5 block text-[11px] italic leading-relaxed text-muted">
                          {line.note}
                        </span>
                      ) : null}
                    </Td>
                    <Td muted>{line.sku}</Td>
                    <Td muted>
                      {placement
                        ? `${meters(placement.size.lengthMm)} × ${meters(placement.size.widthMm)} × ${meters(placement.size.heightMm)} m`
                        : "—"}
                    </Td>
                    <Td muted>{line.optionNames.join(", ") || "—"}</Td>
                    <Td align="right">{line.quantity}</Td>
                    {role !== "guest" ? (
                      <Td align="right">{line.rowTotal != null ? money(line.rowTotal) : "—"}</Td>
                    ) : null}
                  </tr>
                );
              })}
              {(price?.lines ?? []).length === 0 ? (
                <tr>
                  <Td>—</Td>
                  <Td>{t("quote.emptyLine")}</Td>
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
              <Total label={t("quote.total.machines")} value={money(price.totals.machines)} />
              <Total label={t("quote.total.install")} value={money(price.totals.install)} />
              <Total label={t("quote.total.control")} value={money(price.totals.control)} />
              <Total label={t("quote.total.freight")} value={money(price.totals.freight)} />

              {/* Avdraget står som en egen rad. Ett pris som sänkts utan att
                  det syns är inte en rabatt utan ett annat pris. */}
              {price.adjustment ? (
                <>
                  <div className="flex justify-between border-t border-divider pt-1">
                    <span>{t("quote.listPrice")}</span>
                    <span className="num">{money(price.adjustment.listSek)}</span>
                  </div>
                  <div className="flex justify-between text-accent">
                    <span>{adjustmentLabel(price.adjustment, t)}</span>
                    <span className="num">−{money(price.adjustment.deltaSek)}</span>
                  </div>
                </>
              ) : null}

              <div className="flex justify-between border-t border-ink pt-1 font-medium">
                <span>{t("quote.sumExVat")}</span>
                <span className="num">{money(price.totals.grandTotal)}</span>
              </div>
              {price.adjustment?.note ? (
                <p className="text-xs leading-relaxed text-muted">{price.adjustment.note}</p>
              ) : null}
              <div className="no-print flex justify-between text-xs text-muted">
                <span>{t("quote.margin")}</span>
                <span className="num">
                  {money(price.totals.margin)} · {price.totals.marginPercent} %
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">
              {price?.note ?? t("quote.loginForPrices")}
            </p>
          )}
        </Section>

        <div className="grid gap-6 md:grid-cols-2">
          <Section title={t("quote.technical")}>
            <dl className="text-sm">
              <Line label={t("quote.power")} value={`${metrics.totalPowerKw} kW · 3×400 V`} />
              <Line
                label={t("quote.air")}
                value={metrics.totalAirNlPerMin > 0 ? `${metrics.totalAirNlPerMin} Nl/min · 6 bar` : t("quote.none")}
              />
              <Line
                label={t("quote.pits")}
                value={metrics.pitCount > 0 ? t("quote.pitCount", { count: metrics.pitCount }) : t("quote.nonePlural")}
              />
              <Line label={t("quote.clearHeight")} value={`≥ ${meters(metrics.maxHeightMm + 800)} m`} />
              <Line label={t("quote.hall")} value={`${meters(config.hall.lengthMm)} × ${meters(config.hall.widthMm)} m`} />
              <Line label={t("quote.leadTime")} value={t("quote.weeks", { count: metrics.leadTimeWeeks })} />
              {metrics.manufacturingHours > 0 ? (
                <Line label={t("quote.manufacturing")} value={`${metrics.manufacturingHours} h`} />
              ) : null}
              {metrics.assemblyHours > 0 ? (
                <Line label={t("quote.assembly")} value={`${metrics.assemblyHours} h`} />
              ) : null}
              <Line
                label={t("quote.bottleneck")}
                value={metrics.bottleneck ? metrics.bottleneck.name : t("quote.noBottleneck")}
              />
            </dl>
          </Section>

          <Section title={t("quote.flowConfig")}>
            <dl className="text-sm">
              <Line label={t("sidebar.truckPickup")} value={t(`side.${config.flow.truckPickupSide}`)} />
              {config.flow.startComment ? (
                <Line label={t("points.start")} value={config.flow.startComment} />
              ) : null}
              {(config.flow.markers ?? [])
                .filter((m) => m.comment)
                .map((m) => (
                  <Line
                    key={m.id}
                    label={t(m.role === "start" ? "points.start" : "points.end")}
                    value={m.comment}
                  />
                ))}
              {(config.dimensions ?? []).map((d) => (
                <Line
                  key={d.id}
                  label={d.note || t("dim.saved")}
                  value={`${meters(dimensionLength(d), 2)} m`}
                />
              ))}
              <Line
                label={t("area.product.width")}
                value={`${meters(config.product.packageWidthMinMm)}–${meters(config.product.packageWidthMaxMm)} m`}
              />
              <Line
                label={t("area.product.package")}
                value={`${meters(config.product.packageLengthMm)} × ${meters(config.product.packageHeightMm)} m, ${config.product.packageWeightKg} kg`}
              />
            </dl>
          </Section>
        </div>


        <Section title={t("quote.assumptions")} badge={<Tag tone="accent">{t("quote.draft")}</Tag>}>
          <ul className="ml-4 list-disc text-sm leading-relaxed">
            <li>{t("quote.assume.floor")}</li>
            <li>
              {truckSummary(config, t)} {t("quote.assume.truck")}
            </li>
            <li>
              {t("quote.assume.dims")}{" "}
              {unverifiedCount(layout) > 0
                ? t("quote.assume.unverified", { count: unverifiedCount(layout), total: layout.placements.length })
                : t("quote.assume.verified")}
            </li>
            <li>{t("quote.assume.excluded")}</li>
            <li>{t("quote.assume.vat")}</li>
          </ul>
          <p className="mt-3 border-t border-divider pt-2 text-xs text-muted">
            {t("quote.assume.disclaimer", { phone: COMPANY.phone })}
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
  const t = useT();

  const run = async (kind: "csv" | "dxf") => {
    setBusy(kind);
    const { machineListCsv, planDxf, download, exportName } = await import("@/lib/export");
    if (kind === "csv") {
      download(
        exportName(reference, config.projectName, "csv"),
        machineListCsv(config, layout, price, role, t),
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
        <Button onClick={onBack}>{t("quote.back")}</Button>
        <span className="num text-xs text-muted">{reference}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => run("csv")} disabled={busy !== null}>
            {t("quote.csv")}
          </Button>
          <Button onClick={() => run("dxf")} disabled={busy !== null}>
            {t("quote.dxf")}
          </Button>
          <Button disabled title={t("quote.stepNeedsLogin")}>
            {t("quote.step")}
          </Button>
          <Button variant="primary" onClick={() => window.print()}>
            {t("quote.print")}
          </Button>
        </div>
      </div>
      <p className="mx-auto max-w-[210mm] px-8 pb-2 text-[11px] leading-relaxed text-muted">
        {t("quote.printHelp")}
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

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

/* ── Text ur konfigurationen ───────────────────────────────────────────── */

function truckSummary(
  config: ReturnType<typeof useConfigStore.getState>["config"],
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const aisles = config.drawn.filter((d) => d.kind === "truck");
  if (aisles.length === 0) return t("quote.truck.none");
  const narrowest = Math.min(...aisles.map((a) => Math.min(a.l, a.w)));
  return t(aisles.length === 1 ? "quote.truck.one" : "quote.truck.many", {
    count: aisles.length,
    width: meters(narrowest),
  });
}

function unverifiedCount(layout: ReturnType<typeof useConfigStore.getState>["layout"]): number {
  return layout.placements.filter((p) => p.machine.dimensionsVerified !== true).length;
}

/** Anmärkningarna grupperade per regel, i den ordning de först förekommer. */
function groupByCode(list: { code: string; title: string }[]) {
  const groups = new Map<string, { code: string; title: string; count: number }>();
  for (const d of list) {
    const group = groups.get(d.code);
    if (group) group.count += 1;
    else groups.set(d.code, { code: d.code, title: d.title, count: 1 });
  }
  return [...groups.values()];
}
