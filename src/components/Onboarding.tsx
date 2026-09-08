"use client";

import { useConfigStore } from "@/store/useConfigStore";
import { TEMPLATES, emptyConfig, templateConfig } from "@/lib/templates";
import { Button } from "./ui";

export function Onboarding() {
  const { load, setScreen, toggleAi } = useConfigStore();

  const start = (config: Parameters<typeof load>[0]) => {
    load(config, { resetHistory: true });
    setScreen("configurator");
  };

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto bg-paper p-6">
      <div className="w-full max-w-5xl">
        <div className="kicker mb-2">Digital förstudie på 15 minuter</div>
        <h1 className="mb-2 text-3xl leading-tight">Konfigurera din anläggning</h1>
        <p className="mb-8 max-w-2xl text-sm leading-relaxed text-muted">
          Välj maskiner, svara på fem flödesfrågor och se layouten byggas i planvy och 3D.
          Geometrin räknas fram deterministiskt och valideras mot ett regelverk. Ingen inloggning
          krävs för att bygga.
        </p>

        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <Card
            title="Börja från en mall"
            body="Fyra vanliga pakethanteringslinjer att utgå ifrån och ändra."
            meta="Snabbast"
            onClick={() => start(templateConfig("strolinje"))}
          />
          <Card
            title="Beskriv med egna ord"
            body="Skriv vad ni har och vad ni vill. Assistenten föreslår maskiner och flöde."
            meta="Om terminologin är ny"
            onClick={() => {
              start(templateConfig("strolinje"));
              toggleAi(true);
            }}
          />
          <Card
            title="Bygg från grunden"
            body="Tom canvas, full kontroll över maskinval och ordning."
            meta="Om du vet vad du vill"
            onClick={() => start(emptyConfig())}
          />
        </div>

        <div className="kicker mb-2">Mallar</div>
        <div className="grid gap-2 md:grid-cols-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => start(templateConfig(template.id))}
              className="blueprint bg-white p-3 text-left hover:border-accent"
            >
              <div className="text-[15px]">{template.name}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{template.description}</p>
              <div className="kicker mt-2">{template.machineIds.length} maskiner</div>
            </button>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-3">
          <Button variant="primary" onClick={() => setScreen("configurator")}>
            Fortsätt till konfiguratorn
          </Button>
          <span className="text-[11px] text-muted">
            Prototyp med placeholder-maskindata. Priser är påhittade.
          </span>
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
