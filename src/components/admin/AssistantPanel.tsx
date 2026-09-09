"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Tag } from "../ui";
import { Grid, Panel, SelectField, TextField } from "./fields";
import { RunsPanel } from "./RunsPanel";

/**
 * Vilken modell assistenten går mot.
 *
 * Valet är en driftinställning: samma verktyg, samma systemprompt och samma
 * regelmotor ligger under, och det som byts ut är modellen som resonerar.
 * Nycklarna sätts i miljön där servern kör — panelen visar om de finns, inte
 * vad de är.
 */

type Provider = "anthropic" | "grok";

type Settings = {
  provider: Provider;
  anthropicModel: string;
  grokModel: string;
};

type Probe = {
  ok: boolean;
  provider?: Provider;
  model?: string;
  seconds?: number;
  rounds?: number;
  answer?: string;
  error?: string | null;
};

const LABEL: Record<Provider, string> = {
  anthropic: "Anthropic · Claude",
  grok: "xAI · Grok",
};

const KEY_NAME: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  grok: "XAI_API_KEY",
};

export function AssistantPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<Record<Provider, boolean>>({ anthropic: false, grok: false });
  const [active, setActive] = useState<Provider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/settings");
    if (!response.ok) {
      setError("Kunde inte läsa inställningarna.");
      return;
    }
    const body = await response.json();
    setSettings(body.settings);
    setKeys(body.keys);
    setActive(body.active);
    setError(null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!settings) {
    return (
      <Panel title="Assistent">
        <p className="text-xs text-muted">{error ?? "Läser…"}</p>
      </Panel>
    );
  }

  const save = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        setError(body?.error ?? `Servern svarade ${response.status}.`);
        return;
      }
      setActive(body.active);
      setMessage(
        body.persisted
          ? "Sparat. Nya frågor går till den valda modellen."
          : `Sparat i minnet. ${body.reason ?? ""} Det försvinner vid omstart.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setProbing(true);
    setProbe(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setProbe(await response.json());
    } catch {
      setProbe({ ok: false, error: "Nätverket svarade inte." });
    } finally {
      setProbing(false);
    }
  };

  const chosen = settings.provider;
  const missingKey = !keys[chosen];

  return (
    <>
      <Panel
        title="Assistent"
        description="Vilken modell frågorna går till. Samma verktyg och samma regelmotor under, oavsett val."
        action={
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            {busy ? "Sparar…" : "Spara"}
          </Button>
        }
      >
        {error ? (
          <p className="mb-3 border border-danger px-2 py-1 text-xs text-danger">{error}</p>
        ) : null}
        {message ? (
          <p className="mb-3 border border-accent px-2 py-1 text-xs text-accent">{message}</p>
        ) : null}

        <Grid cols={3}>
          <SelectField
            label="Leverantör"
            value={settings.provider}
            options={[
              { value: "anthropic" as Provider, label: LABEL.anthropic },
              { value: "grok" as Provider, label: LABEL.grok },
            ]}
            onChange={(provider) => setSettings({ ...settings, provider })}
          />
          <TextField
            label="Claude-modell"
            value={settings.anthropicModel}
            mono
            onChange={(anthropicModel) => setSettings({ ...settings, anthropicModel })}
            hint="t.ex. claude-opus-5"
          />
          <TextField
            label="Grok-modell"
            value={settings.grokModel}
            mono
            onChange={(grokModel) => setSettings({ ...settings, grokModel })}
            hint="t.ex. grok-4"
          />
        </Grid>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          {(["anthropic", "grok"] as Provider[]).map((provider) => (
            <span key={provider} className="flex items-center gap-1">
              <Tag tone={keys[provider] ? "accent" : "warn"}>
                {keys[provider] ? "nyckel finns" : "nyckel saknas"}
              </Tag>
              <span className="num">{KEY_NAME[provider]}</span>
            </span>
          ))}
          {active ? (
            <span className="text-muted">
              Går just nu mot <strong>{LABEL[active]}</strong>
              {active !== chosen ? ` — ${LABEL[chosen]} saknar nyckel` : ""}.
            </span>
          ) : (
            <span className="text-danger">
              Ingen nyckel är satt. Assistenten svarar med regelmotorns egna förslag.
            </span>
          )}
        </div>

        {missingKey ? (
          <p className="mt-3 border border-divider bg-paper px-2 py-2 text-[11px] leading-relaxed text-muted">
            Sätt <span className="num">{KEY_NAME[chosen]}</span> bland serverns miljövariabler och
            starta om tjänsten. Nycklar går inte att spara härifrån — en nyckel som kan skrivas via
            webben kan också läsas ut den vägen.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Driftprov"
        description="Ställer en riktig fråga med riktiga verktyg mot den valda modellen."
        action={
          <Button size="sm" disabled={probing} onClick={test}>
            {probing ? "Provar…" : "Provkör"}
          </Button>
        }
      >
        {probe ? (
          <div className="text-xs leading-relaxed">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Tag tone={probe.ok ? "accent" : "warn"}>{probe.ok ? "Svarade" : "Misslyckades"}</Tag>
              {probe.model ? <span className="num">{probe.model}</span> : null}
              {typeof probe.seconds === "number" ? (
                <span className="num text-muted">{probe.seconds} s</span>
              ) : null}
              {typeof probe.rounds === "number" ? (
                <span className="text-muted">{probe.rounds} rundor</span>
              ) : null}
            </div>
            {probe.error ? <p className="text-danger">{probe.error}</p> : null}
            {probe.answer ? <p className="whitespace-pre-wrap">{probe.answer}</p> : null}
          </div>
        ) : (
          <p className="text-xs text-muted">
            Provet kostar ett par tusen token och tar några sekunder. Det visar om nyckeln
            fungerar och om modellen klarar verktygsanropen.
          </p>
        )}
      </Panel>

      <RunsPanel />
    </>
  );
}
