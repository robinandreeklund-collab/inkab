"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { meters, mkr, todayISO } from "@/lib/format";
import { Button, Tag } from "./ui";
import type { PriceResult } from "@/lib/server/pricing";

export function QuoteView({ price, role }: { price: PriceResult | null; role: "guest" | "sales" }) {
  const { config, layout, setScreen } = useConfigStore();
  const metrics = layout.metrics;
  const errors = layout.diagnostics.filter((d) => d.severity === "error");

  return (
    <div className="scroll-thin h-full overflow-y-auto bg-paper">
      <div className="mx-auto max-w-4xl p-6">
        <div className="no-print mb-6 flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <div className="kicker">Offertunderlag · utkast</div>
            <h1 className="text-2xl leading-tight">{config.projectName}</h1>
            <p className="text-xs text-muted">
              Underlag {todayISO()}
              {price ? ` · ${price.priceBookName} giltig t.o.m. ${price.validUntil}` : ""}
            </p>
          </div>
          <Button onClick={() => setScreen("configurator")}>Tillbaka till vyn</Button>
          <Button variant="primary" onClick={() => window.print()}>
            Skriv ut / spara som PDF
          </Button>
        </div>

        {errors.length > 0 ? (
          <div className="mb-6 border border-danger bg-white p-3">
            <div className="mb-1 flex items-center gap-2">
              <Tag tone="danger">{errors.length} fel</Tag>
              <span className="text-[13px]">Layouten har olösta fel</span>
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Underlaget går att ta fram ändå, men {errors.length === 1 ? "felet" : "felen"} måste
              lösas innan anläggningen kan byggas: {errors.map((e) => e.code).join(", ")}.
            </p>
          </div>
        ) : null}

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Totalmått"
            value={`${meters(metrics.totalLengthMm)} × ${meters(metrics.totalWidthMm)} m`}
            note={`Golvyta ${metrics.footprintM2} m² inkl. gångar`}
          />
          <Stat
            label="Kapacitet"
            value={metrics.throughputPerHour > 0 ? `${metrics.throughputPerHour} pkt/h` : "—"}
            note={metrics.bottleneck ? `Flaskhals: ${metrics.bottleneck.name}` : "—"}
          />
          <Stat
            label={price?.totals ? "Listpris" : "Prisintervall"}
            value={
              price?.totals
                ? mkr(price.totals.grandTotal)
                : price
                  ? `${mkr(price.indication.lowSek)}–${mkr(price.indication.highSek)}`
                  : "—"
            }
            note={price?.note ?? ""}
          />
        </div>

        <Section title="Maskinlista">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink text-left">
                <Th>Pos</Th>
                <Th>Benämning</Th>
                <Th>Artikel</Th>
                <Th>Optioner</Th>
                <Th>Antal</Th>
                {role === "sales" ? <Th align="right">Radpris</Th> : null}
              </tr>
            </thead>
            <tbody>
              {(price?.lines ?? []).map((line) => (
                <tr key={line.instanceId} className="border-b border-divider">
                  <Td>{line.pos}</Td>
                  <Td>{line.name}</Td>
                  <Td muted>{line.sku}</Td>
                  <Td muted>{line.optionNames.join(", ") || "—"}</Td>
                  <Td>{line.quantity}</Td>
                  {role === "sales" ? (
                    <Td align="right">{line.rowTotal != null ? formatSek(line.rowTotal) : "—"}</Td>
                  ) : null}
                </tr>
              ))}
              {(price?.lines ?? []).length === 0 ? (
                <tr>
                  <Td>—</Td>
                  <Td>Linjen är tom</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  {role === "sales" ? <Td>—</Td> : null}
                </tr>
              ) : null}
            </tbody>
          </table>

          {price?.totals ? (
            <div className="mt-3 ml-auto w-full max-w-xs space-y-1 text-sm">
              <Total label="Maskiner" value={price.totals.machines} />
              <Total label="Montage" value={price.totals.install} />
              <Total label="El och styr" value={price.totals.control} />
              <Total label="Frakt" value={price.totals.freight} />
              <div className="flex justify-between border-t border-ink pt-1 font-medium">
                <span>Summa</span>
                <span className="num">{formatSek(price.totals.grandTotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted">
                <span>Marginal</span>
                <span className="num">
                  {formatSek(price.totals.margin)} · {price.totals.marginPercent} %
                </span>
              </div>
            </div>
          ) : null}
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
                label="Paket"
                value={`${meters(config.product.packageLengthMm)} × ${meters(config.product.packageWidthMm)} × ${meters(config.product.packageHeightMm)} m, ${config.product.packageWeightKg} kg`}
              />
            </dl>
          </Section>
        </div>

        <Section
          title="Antaganden och avgränsningar"
          badge={<Tag tone="accent">Utkast</Tag>}
        >
          <p className="text-sm leading-relaxed">
            Underlaget förutsätter plant betonggolv med minst 25 kN/m² bärighet och att befintlig
            linje lämnar paket på 900 mm höjd. Truckgatan är räknad {meters(5000)} m bred på{" "}
            {sideLabel(config.flow.truckPickupSide).toLowerCase()} sida. Elprojektering, riskanalys,
            hallmätning och fundamentritningar ingår inte.
          </p>
          <p className="mt-2 text-xs text-muted">
            Priset är en indikation och inte en bindande offert. Granskas av säljare innan utskick.
          </p>
        </Section>

        <Section title="Export">
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => window.print()}>
              Skriv ut / spara som PDF
            </Button>
            <Button disabled title="Byggs i nästa fas">DXF av planvyn</Button>
            <Button disabled title="Byggs i nästa fas">Excel av maskinlistan</Button>
            <Button disabled title="Kräver inloggning och nedladdningslogg">STEP-filer</Button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            PDF genereras via webbläsarens utskrift i prototypen. I skarpt läge renderas den på
            servern med måttsatt vektorritning.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="kicker">{title}</h2>
        {badge}
      </div>
      <div className="border border-divider bg-white p-3">{children}</div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="blueprint bg-white p-3">
      <div className="kicker">{label}</div>
      <div className="num text-xl">{value}</div>
      <div className="text-[11px] text-muted">{note}</div>
    </div>
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
      className={`py-1.5 ${muted ? "text-muted" : ""} ${align === "right" ? "num text-right" : ""}`}
    >
      {children}
    </td>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-divider py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="num">{formatSek(value)}</span>
    </div>
  );
}

function formatSek(amount: number): string {
  return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(amount)} kr`;
}

function infeedLabel(value: string): string {
  return { straight: "Rakt", right: "Från höger", left: "Från vänster" }[value] ?? value;
}

function sideLabel(value: string): string {
  return value === "right" ? "Höger" : "Vänster";
}
