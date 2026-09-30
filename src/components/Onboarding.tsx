"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { TEMPLATES, emptyConfig, templateConfig } from "@/lib/templates";
import { Button } from "./ui";
import { useT } from "@/lib/i18n";

export function Onboarding() {
  const { load, setScreen, library } = useConfigStore();
  const t = useT();

  const start = (config: Parameters<typeof load>[0], what: string) => {
    load(config, { resetHistory: true, note: what });
    setScreen("configurator");
  };

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
            onClick={() => start(templateConfig("strolinje", library), "Startade från mallen Truckströläggning – enkel")}
          />
          <Card
            title={t("onboarding.scratch.title")}
            body={t("onboarding.scratch.body")}
            meta={t("onboarding.scratch.meta")}
            onClick={() => start(emptyConfig(), "Startade från en tom ritning")}
          />
        </div>

        <div className="kicker mb-2">{t("onboarding.templates")}</div>
        <div className="grid gap-2 md:grid-cols-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => start(templateConfig(template.id, library), `Startade från mallen ${template.name}`)}
              className="blueprint bg-white p-3 text-left hover:border-accent"
            >
              <div className="text-[15px]">{template.name}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{template.description}</p>
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
