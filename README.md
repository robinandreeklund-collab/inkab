# INKAB Layout Configurator

Webbaserat verktyg där kunder konfigurerar en pakethanteringsanläggning för
sågverk: välj maskiner, svara på fem flödesfrågor, se layouten byggas i planvy
och 3D, och ta fram ett offertunderlag.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/robinandreeklund-collab/inkab/tree/claude/package-handling-config-tool-2yp0dp)

> **Prototyp (fas 1).** Layoutmotorn, regelverket, prissättningen och
> AI-assistenten är på riktigt. **Maskindata och priser är påhittade
> placeholder-siffror** och ska ersättas med INKAB:s egna innan verktyget visas
> för kund. Se [Vad som är verkligt](#vad-som-är-verkligt-och-vad-som-inte-är-det).

Arkitekturunderlaget finns i [`docs/forslag.md`](docs/forslag.md).
Designreferensen (Claude Design-prototypen) ligger i
[`design/inkab-konfigurator.html`](design/inkab-konfigurator.html).

---

## Deploya till Render

Klicka på knappen ovan. Render läser [`render.yaml`](render.yaml) och sätter upp
en webbtjänst på gratisplanen i Frankfurt.

Vid deployen frågar Render om två miljövariabler:

| Variabel | Krävs | Vad den gör |
|---|---|---|
| `ANTHROPIC_API_KEY` | Nej | Slår på AI-assistenten. **Utan nyckel fungerar allt annat precis som vanligt** — assistenten faller tillbaka på regelmotorns egna åtgärdsförslag och säger tydligt att den saknar nyckel. |
| `SALES_PASSWORD` | Nej | Lösenord till säljläget som visar listpriser och marginal. Standardvärdet är `inkab`. **Byt det efter första deployen.** |

Första bygget tar ett par minuter. Gratisplanen somnar efter inaktivitet, så
första anropet efter en paus tar cirka 30 sekunder.

**Om knappen deployar fel kod:** Render tar standardgrenen om ingen anges.
Knappen ovan pekar därför på utvecklingsgrenen. När grenen är mergad till
`main` fungerar även den korta varianten:
`https://render.com/deploy?repo=https://github.com/robinandreeklund-collab/inkab`

---

## Kör lokalt

```bash
npm install
cp .env.example .env.local   # valfritt: lägg in ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

```bash
npm test         # 45 tester mot layoutmotorn och regelverket
npm run typecheck
npm run build
```

Node 20 eller senare.

---

## Vad som är verkligt, och vad som inte är det

Designprototypen som föregick det här hade ett övertygande gränssnitt men
hårdkodad geometri: flödesfrågorna flyttade ett par förutbestämda koordinater,
varningarna var literal text och AI-förslagen var statiska. **Det här bygget
vänder på det** — motorerna är byggda, datan är det som saknas.

### Byggt och verifierat

| Del | Status |
|---|---|
| **Layoutmotor** | Deterministisk kedjevandring med portmatchning, rotation, spegling och frigångslogik. Ren funktion, samma indata ger alltid samma geometri. |
| **De fem flödesfrågorna** | Driver geometrin på riktigt. Verifierat i test: pulpeten byter sida, magasinet byter sida, truckgatan flyttar sig, inmatningsriktningen vinklar linjen, och transportörlängden ändrar både layout och totalmått. |
| **Regelverk** | 17 regler beräknade ur geometrin — kollisioner, zoner, hallgränser, truckgata, buffert, kapacitet, paketmått, beroenden. Varje regel kan ge ett åtgärdsförslag som går att applicera med ett klick. |
| **Prissättning** | Beräknas på servern. Prisboken är märkt `server-only` — bygget kraschar om en klientkomponent försöker importera den. |
| **Rollmodell** | Gäst ser prisintervall, säljläge ser listpris, radpriser och marginal. Serversidan avgör, inte klienten. |
| **AI-assistent** | Claude Opus 5 med verktygsskal, adaptive thinking, streaming och prompt-cachning. Modellen kan bara läsa biblioteket och mutera konfigurationen — den räknar aldrig geometri och kan inte hitta på priser. |
| **CAD-vy** | Planvy och isometrisk 3D i SVG. Drag med snapp, rita väggar och no-go-zoner, måttband, zoom, zoner, portar, måttsättning och diagnostik förankrad i geometrin. |
| **Övrigt** | Ångra/gör om, autospar, delningslänk med konfigurationen i URL:en, offertunderlag med utskrift till PDF, fyra startmallar, tangentbordsgenvägar. |

### Inte byggt — och medvetet så

| Del | Varför |
|---|---|
| **Verklig maskindata** | 13 branschgeneriska maskiner i `src/lib/library.ts`. Mått, kapacitet och portar är kvalificerade gissningar. **Detta är det enda som står mellan prototypen och något ni kan visa en kund.** |
| **Verkliga priser** | Påhittade siffror i `src/lib/server/pricebook.ts`. |
| **STEP-filer** | Knappen finns och förklarar vad som skulle hända. Inga CAD-filer levereras. |
| **Riktig inloggning** | Delat lösenord i en cookie. Ska bli Auth.js med magisk länk för kund och Entra ID internt. |
| **Databas** | Konfigurationen lever i webbläsaren och i delningslänken. Inga sparade projekt, ingen offerthistorik. |
| **Server-renderad PDF** | Utskrift via webbläsaren. Skarpt läge ska rendera måttsatt vektorritning på servern. |
| **three.js och GLB-modeller** | 3D-vyn är SVG-isometri. Det bär inte riktiga maskinmodeller, men det finns inga sådana ännu — bytet görs när modellerna finns. |
| **DXF- och Excel-export** | Knappar finns, avstängda. |

---

## Arkitektur

```
  Konfiguration (ren JSON)
          │
          ▼
  ┌───────────────────────────────┐
  │  solveLayout()                │   src/lib/solver.ts
  │  portmatchning · rotation ·   │   Deterministisk. Ingen AI.
  │  spegling · frigång · zoner   │
  └───────────────┬───────────────┘
                  ▼
  ┌───────────────────────────────┐
  │  runRules()                   │   src/lib/rules.ts
  │  17 regler → Diagnostic[]     │   Varje fel kan bära ett åtgärdsförslag.
  └───────────────┬───────────────┘
                  ▼
          LayoutResult
                  │
      ┌───────────┼────────────┬──────────────┐
      ▼           ▼            ▼              ▼
   CAD-vy     Statusrad    Offertvy      Claude-verktygen
   (SVG)                   (server-      (läser och muterar,
                            beräknat      räknar aldrig själv)
                            pris)
```

**Den bärande principen:** geometri och pris är deterministiska; AI:n resonerar,
förklarar och föreslår. Assistenten når systemet enbart via verktyg som
returnerar den omräknade layouten, så den ser konsekvensen av sin egen ändring
och kan korrigera sig — samma återkoppling en människa får i gränssnittet.
Den applicerar aldrig en ändring åt kunden; den sparar ett förslag som kunden
själv väljer att använda.

### Koordinatsystem

All geometri i heltal millimeter. X längs hallen, Y tvärs, Z uppåt. I planvyn
är X åt höger och Y nedåt. **Med blicken i flödesriktningen är höger `+Y` och
vänster `−Y`** — den konventionen avgör vad de fyra sidofrågorna betyder.

### Filträd

```
src/
├── lib/
│   ├── types.ts          Domänmodellen
│   ├── geometry.ts       Rotation, spegling, boxar, snitt
│   ├── projection.ts     Isometrisk projektion och dess invers
│   ├── library.ts        ⚠ Maskinbibliotek — placeholder-data
│   ├── solver.ts         Layoutmotorn
│   ├── rules.ts          Regelverket
│   ├── layout.ts         computeLayout() — enda ingången
│   ├── templates.ts      Fyra startmallar
│   ├── schema.ts         Zod-validering av allt som når servern
│   ├── share.ts          Konfiguration ⇄ URL
│   ├── ai/
│   │   ├── tools.ts      Verktygsskalet
│   │   ├── prompt.ts     Systemprompt med cache-brytpunkt
│   │   └── fallback.ts   Regelbaserade förslag utan API-nyckel
│   └── server/
│       ├── pricebook.ts  ⚠ Priser — server-only, placeholder-data
│       ├── pricing.ts    Rollfiltrerad prisberäkning
│       └── session.ts    Rollmodell
├── components/           Skal, sidebar, CAD-vy, inspektor, AI-panel, offert
├── store/                Zustand med historik och autospar
└── app/
    ├── page.tsx
    └── api/              ai/chat · price · session · health
```

---

## Regelverket

| Kod | Regel | Nivå |
|---|---|---|
| R-101 | Portarna ligger på olika höjd, eller glapp efter manuell förskjutning | fel / varning |
| R-102 | Linjen vänds aldrig längs hallen — tvärtransportör saknas | fel |
| R-103 | Maskiner överlappar | fel |
| R-104 | Servicezon blockerad av annan maskin | varning |
| R-105 | Skyddszon skär truckgatan | fel |
| R-201 | Truckgatan får inte plats i hallen | fel |
| R-202 | Sista transportören rymmer inte två pakets buffert | varning |
| R-203 | Pulpet eller magasin står i truckgatan | fel |
| R-204 | Trucken måste korsa flödet för att nå magasinet | varning |
| R-301 | Kapaciteten understiger målet | varning |
| R-302 | Paketets mått ligger utanför maskinens intervall | fel |
| R-303 | Paketet är för tungt | fel |
| R-401 | Maskinen hamnar utanför hallen | fel |
| R-402 | Maskinen är högre än fri höjd | fel |
| R-403 | Kollision med ritad vägg eller no-go-zon | fel |
| R-501 | Beroende saknas eller maskiner kan inte kombineras | fel |
| R-601 | Ovanlig ordning i kedjan | info |

Reglerna bor i `src/lib/rules.ts`, en funktion per grupp. Att lägga till en
regel är att lägga till ett block som returnerar `Diagnostic[]`.

---

## Lägga till en maskin

Redigera `src/lib/library.ts`. Det som kräver eftertanke är **portarna** — allt
annat är formulärfält.

```ts
{
  id: "pl4",
  sku: "PL4-STD",
  name: "Paketläggare PL4",
  category: "stacking",
  summary: "Kort beskrivning som visas i inspektorn.",
  footprint: { lengthMm: 9200, widthMm: 5400, heightMm: 4600 },

  // Lokalt system: origo i minhörnet, X = flödesriktning, Y = tvärled.
  ports: [
    { id: "in",  role: "in",  pos: { x: 0,    y: 2700 }, dir: "x+",
      levelMm: 900, widthMm: [600, 2400], allowsDirectionChange: false },
    { id: "out", role: "out", pos: { x: 9200, y: 2700 }, dir: "x+",
      levelMm: 900, widthMm: [600, 2400], allowsDirectionChange: false },
  ],

  mirrorable: true,        // kan speglas när pulpeten ska stå på andra sidan
  operatorPriority: 4,     // högre värde drar pulpeten hit
  zones: [{ type: "service", box: { x: 0, y: -1400, l: 9200, w: 1400 },
            label: "Service PL4" }],
  // ...kapacitet, utilities, foundation, leadTimeWeeks, options
}
```

En maskin som vinklar flödet 90° sätter `allowsDirectionChange: true` på
utporten och ger den en annan `dir` än inporten — se `tt1`.
Portar och zoner skalas automatiskt när optioner ändrar måtten.

Lägg sedan in priset i `src/lib/server/pricebook.ts`. Kör `npm test` — mallarna
valideras mot regelverket, så ett felaktigt portpar upptäcks direkt.

---

## Tangentbordsgenvägar

| Tangent | Gör |
|---|---|
| `1` / `2` | Planvy / isometrisk vy |
| `V` `W` `N` `M` | Markera · vägg · no-go · mät |
| `Z` / `P` | Visa zoner / portar |
| `F` | Fäll in inspektorn |
| `Delete` | Ta bort markerat objekt |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Ångra / gör om |

---

## AI-assistenten

Verktygen modellen har: `get_machine_library`, `get_current_layout`, `set_flow`,
`add_machine`, `remove_machine`, `set_hall`, `estimate_price`, `propose_variant`.

Skyddsräcken:

- **Ingen geometri.** Modellen ändrar konfigurationen; motorn räknar.
- **Inga påhittade maskiner.** `add_machine` validerar mot biblioteket och
  returnerar ett fel som modellen ser och rättar sig efter.
- **Inga påhittade priser.** Prisboken finns aldrig i prompten. `estimate_price`
  returnerar serverberäknade belopp.
- **Applicerar aldrig åt kunden.** `propose_variant` sparar ett förslag och
  återställer arbetskopian. Kunden klickar själv.
- **Tak per tur.** Högst tolv verktygsrundor.
- **Degraderar rent.** Utan nyckel, vid API-fel eller vid ett avböjt svar
  fortsätter verktyget att fungera fullt ut.

Systemprompten har en cache-brytpunkt efter maskinbiblioteket; konfigurationen
och frågan ligger efter den så att cachen inte invalideras vid varje anrop.

---

## Nästa steg

1. **Ersätt maskinbiblioteket med INKAB:s verkliga data.** Fem riktiga maskiner
   med riktiga portar är värt mer än trettio gissade.
2. **Håll workshop om flödesreglerna** med konstruktörerna och skriv om
   `rules.ts` efter vad som faktiskt gäller. Reglerna är produkten.
3. **Låt tre konstruktörer testa** och räkna hur ofta de säger "så gör vi
   aldrig". Det talet är prototypens verkliga betyg.
4. Därefter fas 2 enligt [`docs/forslag.md`](docs/forslag.md): inloggning,
   databas, serverrenderad PDF, STEP-leverans.
