import "server-only";
import { randomBytes } from "node:crypto";
import { runAssistant, type AssistantAttachment } from "./aiRun";
import type { ResolvedProvider } from "./assistant";
import { saveProposal, writeDraftJob, type StoredDraftJob } from "./store";
import { quoteReference } from "@/lib/quote";
import type { MachineLibrary } from "@/lib/library";
import type { PriceBook } from "./pricebook";
import type { Role } from "./pricing";
import type { Configuration } from "@/lib/types";

/**
 * Förslag som byggs medan kunden gör något annat.
 *
 * Att läsa en ritning, rita upp lokalen och sätta ihop en linje tar minuter.
 * Kunden ska inte behöva sitta och se på. Jobbet startas, svaret på anropet är
 * ett id, och arbetet fortsätter i processen efteråt.
 *
 * Det förutsätter en server som lever mellan anropen — vilket den gör här —
 * och jobbet skriver sitt läge till lagret vartefter, så att en omstart syns
 * som ett avbrutet jobb i stället för som en evig väntan.
 */

/** Bakgrundsjobb får kosta fler rundor än en chattfråga: ingen väntar. */
const MAX_ROUNDS = 16;

const STEPS: Record<string, string> = {
  get_machine_library: "Läser maskinbiblioteket",
  get_current_layout: "Kontrollerar layouten",
  draw_hall: "Ritar upp lokalen",
  clear_line: "Rensar linjen",
  add_machine: "Lägger till maskiner",
  remove_machine: "Tar bort maskiner",
  set_flow: "Sätter flödet",
  set_hall: "Sätter hallens mått",
  estimate_price: "Räknar pris",
  propose_variant: "Sammanställer förslaget",
};

const JOB_PROMPT = `Kunden har laddat upp underlag och vill ha ett färdigt förslag att titta på. Ingen sitter och väntar på svaret, så arbeta klart hela vägen och spara resultatet — ett svar utan sparat förslag är inget svar.

1. Läs bilagorna. Skriv först vad du ser: en ritning över lokalen, ett flödesschema, en skiss, ett foto.
2. Är det en ritning över lokalen — sätt hallens mått och rita upp den med draw_hall. Går skalan inte att fastställa ur ritningen eller ur kundens egna ord: rita inte. Skriv i stället vilket mått du behöver för att kunna göra det.
3. Visar underlaget maskiner eller ett flöde — bygg linjen. clear_line först om du börjar om, sedan add_machine i den ordning flödet går, och set_flow för de fem flödesvalen.
4. Kontrollera med get_current_layout och rätta det du kan innan du sparar.
5. Spara med propose_variant. Är du osäker på en tolkning: spara den rimligaste och beskriv osäkerheten i förslagets beskrivning.

Avsluta med en kort text till kunden: vad du läste ur underlaget, vad du antog, och vad hon bör kontrollera. Håll den under tio meningar.`;

/** Referenser att hålla kvar i, så att jobben inte städas bort halvvägs. */
const running = new Set<Promise<void>>();

export function newJobId(): string {
  return `job-${randomBytes(16).toString("hex")}`;
}

export async function startDraftJob(input: {
  config: Configuration;
  note: string;
  attachments: AssistantAttachment[];
  userId: string | null;
  role: Role;
  library: MachineLibrary;
  priceBook: PriceBook;
  /** Leverantören valdes när jobbet beställdes och gäller hela jobbet. */
  provider?: ResolvedProvider;
}): Promise<StoredDraftJob> {
  const now = new Date().toISOString();
  const job: StoredDraftJob = {
    id: newJobId(),
    userId: input.userId,
    status: "queued",
    note: input.note,
    fileNames: input.attachments.map((a) => a.name),
    step: "I kö",
    summary: "",
    variants: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await writeDraftJob(job);

  const work = run(job, input).finally(() => running.delete(work));
  running.add(work);

  return job;
}

async function run(
  job: StoredDraftJob,
  input: Parameters<typeof startDraftJob>[0],
): Promise<void> {
  let current: StoredDraftJob = { ...job, status: "running", step: "Läser underlaget" };
  await writeDraftJob(current);

  // Skriv inte för varje verktygsanrop: läget är till för att titta på, inte
  // för att räkna på. En rad var tredje sekund räcker gott.
  let lastWrite = Date.now();
  const step = (text: string) => {
    if (text === current.step || Date.now() - lastWrite < 3000) {
      current = { ...current, step: text };
      return;
    }
    lastWrite = Date.now();
    current = { ...current, step: text, updatedAt: new Date().toISOString() };
    void writeDraftJob(current);
  };

  try {
    const result = await runAssistant({
      config: input.config,
      message: `${JOB_PROMPT}\n\nKundens egna ord: ${input.note.trim() || "(inget skrivet)"}`,
      attachments: input.attachments,
      role: input.role,
      library: input.library,
      priceBook: input.priceBook,
      provider: input.provider,
      maxRounds: MAX_ROUNDS,
      // Ingen väntar på jobbet, så det får tänka så noga det behöver.
      effort: "high",
      onEvent: (event) => {
        if (event.type === "tool" && event.phase === "run") {
          step(STEPS[event.name] ?? "Arbetar");
        }
      },
    });

    /*
     * Sparade förslag är det jobbet levererar. Har assistenten ändrat
     * arbetskopian men glömt att spara den blir ändringen ändå ett förslag —
     * annars vore arbetet borta för att ett verktygsanrop uteblev.
     */
    let variants = result.variants.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      config: v.config as unknown,
    }));
    if (
      variants.length === 0 &&
      JSON.stringify(result.draft) !== JSON.stringify(input.config)
    ) {
      variants = [
        {
          id: "v1",
          name: "Förslag från ditt underlag",
          description:
            "Assistenten arbetade om layouten efter underlaget men sparade den inte " +
            "själv. Granska den extra noga.",
          config: result.draft as unknown,
        },
      ];
    }

    current = {
      ...current,
      status: result.error ? "failed" : "done",
      step: result.error ? "Avbröts" : "Klart",
      summary: result.text.trim(),
      variants,
      error: result.error,
      updatedAt: new Date().toISOString(),
    };
    await writeDraftJob(current);

    // Är kunden inloggad ska förslaget finnas kvar även om fliken stängs.
    if (current.userId && variants.length > 0) {
      const config = variants[0].config as Configuration;
      await saveProposal({
        id: `p-${current.id.slice(4, 20)}`,
        userId: current.userId,
        name: variants[0].name,
        reference: quoteReference(config),
        config,
      });
    }
  } catch (error) {
    current = {
      ...current,
      status: "failed",
      step: "Avbröts",
      error: error instanceof Error ? error.message : "Jobbet misslyckades.",
      updatedAt: new Date().toISOString(),
    };
    await writeDraftJob(current);
  }
}
