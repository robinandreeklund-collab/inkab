"use client";

import { useEffect, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { TEMPLATES, emptyConfig, templateConfig } from "@/lib/templates";
import { Button } from "./ui";
import { useT } from "@/lib/i18n";

export function Onboarding() {
  const { load, setScreen, library, libraryLoaded } = useConfigStore();
  const t = useT();

  const start = (config: Parameters<typeof load>[0], what: string) => {
    load(config, { resetHistory: true, note: what });
    setScreen("configurator");
  };

  /*
   * En mall byggs med maskinernas mått, och måtten kommer från serverns
   * katalog. Klickade man innan den hunnit laddas byggdes mallen med det
   * inbyggda biblioteket — andra mått — och när katalogen kom krockade
   * maskinerna: en ny mall öppnade med fel och varningar. Mallen väntar
   * därför in katalogen; klicket glöms inte bort under tiden.
   */
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const startTemplate = (id: string, name: string) => {
    if (!libraryLoaded) {
      setPending({ id, name });
      return;
    }
    start(templateConfig(id, library, t), `Startade från mallen ${name}`);
  };
  useEffect(() => {
    if (!libraryLoaded || !pending) return;
    start(templateConfig(pending.id, library, t), `Startade från mallen ${pending.name}`);
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryLoaded, pending, library]);

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto bg-paper p-6">
      <div className="w-full max-w-5xl">
        <div className="kicker mb-2">{t("onboarding.kicker")}</div>
        <h1 className="mb-2 text-3xl leading-tight">{t("onboarding.title")}</h1>
        <p className="mb-8 max-w-2xl text-sm leading-relaxed text-muted">{t("onboarding.lead")}</p>

        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <Card
            title={t("onboarding.template.title")}
            body={t("onboarding.template.body")}
            meta={t("onboarding.template.meta")}
            onClick={() => startTemplate("strolinje", t("template.strolinje.name"))}
          />
          <Card
            title={t("onboarding.scratch.title")}
            body={t("onboarding.scratch.body")}
            meta={t("onboarding.scratch.meta")}
            onClick={() => start(emptyConfig(t), "Startade från en tom ritning")}
          />
        </div>

        {pending ? (
          <p className="mb-4 border border-accent bg-white px-3 py-2 text-xs text-accent">
            {t("onboarding.loadingCatalogue")}
          </p>
        ) : null}

        <div className="kicker mb-2">{t("onboarding.templates")}</div>
        <div className="grid gap-2 md:grid-cols-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => startTemplate(template.id, t(`template.${template.id}.name`))}
              className="blueprint bg-white p-3 text-left hover:border-accent"
            >
              <div className="text-[15px]">{t(`template.${template.id}.name`)}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{t(`template.${template.id}.desc`)}</p>
              <div className="kicker mt-2">{t("onboarding.machineCount", { count: template.machineIds.length })}</div>
            </button>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-3">
          <Button variant="primary" onClick={() => setScreen("configurator")}>
            {t("onboarding.continue")}
          </Button>
          <span className="text-[11px] text-muted">{t("onboarding.disclaimer")}</span>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  body,
  meta,
  onClick,
}: {
  title: string;
  body: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="blueprint bg-white p-4 text-left hover:border-accent">
      <div className="mb-2 text-base">{title}</div>
      <p className="text-xs leading-relaxed text-muted">{body}</p>
      <div className="kicker mt-3">{meta}</div>
    </button>
  );
}
