"use client";

import { useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { canSubmitQuote, quoteReference } from "@/lib/quote";
import { useT } from "@/lib/i18n";
import { Button } from "./ui";
import type { SessionUser } from "./AuthDialog";

/**
 * Kunden skickar in sitt underlag.
 *
 * Sista steget, och det enda stället i verktyget där kunden lämnar ifrån sig
 * något. Formuläret frågar därför bara om det som behövs för att svara —
 * namn och e-post — och lägger företag, telefon och ett meddelande som
 * frivilligt. Allt annat vet underlaget redan: maskinerna, måtten, zonerna,
 * anteckningarna på varje maskin och hela projektloggen följer med.
 *
 * Inget konto krävs. Den som byggt en anläggning i en kvart ska inte behöva
 * registrera sig för att höra av sig, och den som ändå är inloggad får
 * inskickningen på sitt konto.
 *
 * Efter inskickningen står underlagsnumret kvar i rutan. Det är vad kunden
 * har att hänvisa till, och vad säljaren känner igen offerten på.
 */

type Fields = {
  name: string;
  email: string;
  company: string;
  phone: string;
  message: string;
};

export function SubmitQuoteDialog({
  onClose,
  user,
  onLogin,
}: {
  onClose: () => void;
  /** Inloggad kund: då vet vi redan vem som frågar. */
  user: SessionUser | null;
  onLogin: () => void;
}) {
  const {
    config,
    log,
    note: writeLog,
    proposalId,
    setProposalId,
  } = useConfigStore();
  const t = useT();
  const reference = quoteReference(config);

  /*
   * Är kunden inloggad vet vi redan vem det är: namn och adress kommer ur
   * kontot i stället för att frågas en gång till. Fälten går att ändra —
   * den som bygger åt en kollega ska kunna skriva kollegans adress.
   */
  const [fields, setFields] = useState<Fields>({
    name: user?.name || config.customer?.contact || "",
    email: user?.email ?? "",
    company: user?.company || config.customer?.company || "",
    phone: "",
    message: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{
    reference: string;
    persisted: boolean;
  } | null>(null);

  const set = (key: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  /*
   * Vad som saknas, utskrivet.
   *
   * Förut var knappen bara avstängd, utan ett ord om varför — och ett tomt
   * underlag gick dessutom igenom. Samma krav som servern ställer, så att
   * knappen inte lovar något den inte kan hålla: minst en maskin, ett namn
   * och en adress som går att svara till.
   */
  const missing: string[] = [];
  if (!canSubmitQuote(config)) missing.push(t("submit.needMachine"));
  if (fields.name.trim().length === 0) missing.push(t("submit.needName"));
  if (!/.+@.+\..+/.test(fields.email.trim()))
    missing.push(t("submit.needEmail"));
  const ready = missing.length === 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/quote-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: proposalId ?? undefined,
          config,
          log,
          contact: {
            name: fields.name.trim(),
            email: fields.email.trim(),
            company: fields.company.trim() || undefined,
            phone: fields.phone.trim() || undefined,
            message: fields.message.trim() || undefined,
          },
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        setError(
          body?.error ?? t("submit.failed", { status: response.status }),
        );
        return;
      }
      if (body.id) setProposalId(body.id);
      writeLog(
        "proposal",
        t("submit.logged", { reference: body.reference ?? reference }),
      );
      setSent({
        reference: body.reference ?? reference,
        persisted: body.persisted === true,
      });
    } catch {
      setError(t("submit.offline"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-lg border border-divider bg-white p-4 text-ink shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="kicker">{t("submit.title")}</h2>
          <button
            onClick={onClose}
            className="ml-auto text-muted hover:text-ink"
            aria-label={t("submit.close")}
          >
            ×
          </button>
        </div>

        {sent ? (
          <div>
            <p className="mb-2 text-sm leading-relaxed">
              {t("submit.thanks", { reference: sent.reference })}
            </p>
            <p className="mb-4 text-[11px] leading-relaxed text-muted">
              {sent.persisted ? t("submit.next") : t("submit.notPersisted")}
            </p>
            <Button variant="primary" className="w-full" onClick={onClose}>
              {t("submit.done")}
            </Button>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-[11px] leading-relaxed text-muted">
              {t("submit.lead", {
                reference,
                machines: config.line.length,
              })}
            </p>

            {/*
              Vem som frågar är kravet, och det ska stå utskrivet.
              Inloggad: vi vet redan. Gäst: namn och e-post gör samma jobb,
              och inloggningen finns kvar som genväg för den som har konto.
            */}
            {user ? (
              <p className="mb-3 border border-accent bg-accent/5 px-2 py-1.5 text-[11px] leading-relaxed">
                {t("submit.signedIn", { name: user.name || user.email })}
              </p>
            ) : (
              <p className="mb-3 border border-divider px-2 py-1.5 text-[11px] leading-relaxed text-muted">
                {t("submit.identify")}{" "}
                <button
                  onClick={onLogin}
                  className="text-accent underline hover:text-ink"
                >
                  {t("submit.logIn")}
                </button>
              </p>
            )}

            {/* Tomt underlag stoppas här och på servern. */}
            {!canSubmitQuote(config) ? (
              <p className="mb-3 border border-warn bg-warn/5 px-2 py-1.5 text-[11px] leading-relaxed text-warn">
                {t("submit.emptyLine")}
              </p>
            ) : null}

            {error ? (
              <p className="mb-3 border border-danger px-2 py-1 text-xs text-danger">
                {error}
              </p>
            ) : null}

            <div className="space-y-2">
              {(
                [
                  ["name", "submit.name", true, "name"],
                  ["email", "submit.email", true, "email"],
                  ["company", "submit.company", false, "organization"],
                  ["phone", "submit.phone", false, "tel"],
                ] as const
              ).map(([key, label, required, autoComplete]) => (
                <label key={key} className="block">
                  <span className="kicker mb-1 block">
                    {t(label)}
                    {required ? " *" : ""}
                  </span>
                  <input
                    value={fields[key]}
                    onChange={(e) => set(key)(e.target.value)}
                    type={
                      key === "email"
                        ? "email"
                        : key === "phone"
                          ? "tel"
                          : "text"
                    }
                    autoComplete={autoComplete}
                    className="w-full border border-divider px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </label>
              ))}

              <label className="block">
                <span className="kicker mb-1 block">{t("submit.message")}</span>
                <textarea
                  value={fields.message}
                  onChange={(e) => set("message")(e.target.value)}
                  rows={3}
                  placeholder={t("submit.messagePlaceholder")}
                  className="scroll-thin w-full resize-y border border-divider px-2 py-1 text-sm outline-none focus:border-accent"
                />
              </label>
            </div>

            <Button
              variant="primary"
              className="mt-4 w-full"
              disabled={busy || !ready}
              onClick={submit}
            >
              {busy ? t("submit.sending") : t("submit.send")}
            </Button>
            {/* En avstängd knapp utan ett ord om varför är en återvändsgränd. */}
            {!ready ? (
              <p className="mt-2 text-[11px] leading-relaxed text-warn">
                {t("submit.missing", { what: missing.join(", ") })}
              </p>
            ) : null}
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {t("submit.privacy")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
