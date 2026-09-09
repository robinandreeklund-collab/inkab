# INKAB Layout Configurator

Webbaserat verktyg där kunder konfigurerar en pakethanteringsanläggning för
sågverk: välj maskiner, svara på fem flödesfrågor, se layouten byggas i planvy
och 3D, och ta fram ett offertunderlag.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/robinandreeklund-collab/inkab/tree/claude/package-handling-config-tool-2yp0dp)

> **Prototyp.** Layoutmotorn, regelverket, prissättningen, kontohanteringen,
> admin-vyn och AI-assistenten är på riktigt. **Maskinerna kommer från INKAB:s
> produktkatalog utgåva 1** — namn, funktion, beskrivningar, drivning och
> tekniska data är era egna. **Fotavtryck, portlägen, kapacitet och priser är
> fortfarande uppskattade** och redigeras i admin-vyn. Se
> [Vad som är verkligt](#vad-som-är-verkligt-och-vad-som-inte-är-det).

Arkitekturunderlaget finns i [`docs/forslag.md`](docs/forslag.md), och analysen
av CAD-pipelinen — hur 80 MB STEP blir användbara 3D-modeller — i
[`docs/cad-pipeline.md`](docs/cad-pipeline.md).
Designreferensen (Claude Design-prototypen) ligger i
[`design/inkab-konfigurator.html`](design/inkab-konfigurator.html).

---

## Deploya till Render

Klicka på knappen ovan. Render läser [`render.yaml`](render.yaml) och sätter upp
en webbtjänst på gratisplanen i Frankfurt.

Vid deployen frågar Render om två miljövariabler:

| Variabel | Krävs | Vad den gör |
|---|---|---|
| `ANTHROPIC_API_KEY` | Nej | Slår på AI-assistenten. Läggs in i Render under **din tjänst → Environment → Environment Variables**. **Utan nyckel fungerar allt annat precis som vanligt** — assistenten faller tillbaka på regelmotorns egna åtgärdsförslag och säger tydligt att den saknar nyckel. |
| `DATABASE_URL` | **I praktiken ja** | Postgres-URL från Render, Neon eller Supabase. Utan den lever konton, admins ändringar och uppladdade 3D-modeller bara så länge serverprocessen gör det — och en instans på Renders gratisplan sover in efter en kvarts stillhet, så arbetet är borta när du kommer tillbaka. Admin-vyns lagringsbanner säger vilket läge servern är i, och vyn **Modell** säger till när en modellfil har försvunnit i stället för att tyst rita en låda. **Sätt den innan ni matar in maskindata.** |
| `ADMIN_EMAILS` | Nej | Kommaseparerade adresser som blir admin automatiskt vid registrering. Standard: `robin@inkab.nu,daniel@inkab.nu,lars@inkab.nu`. |
| `AUTH_SECRET` | Nej | Signeringsnyckel för sessionscookien. Utan den genereras en ny vid varje omstart, vilket loggar ut alla. |

### Första inloggningen

Klicka **Logga in → Skapa konto** och registrera dig med en adress som står i
`ADMIN_EMAILS`. Kontot blir admin direkt och **Admin**-knappen dyker upp i
topbaren. Alla andra som registrerar sig blir kund; deras roll ändras under
**Admin → Konton**.

| Roll | Ser |
|---|---|
| Gäst | Bygger fritt, ser prisintervall |
| Kund | Samma, plus sparade uppgifter |
| Säljare | Listpriser, radpriser och marginal |
| Admin | Allt, plus maskinbibliotek, prisbok och konton |

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
| **AI-assistent** | Claude Opus 5 med verktygsskal, adaptive thinking, streaming och prompt-cachning. Modellen kan bara läsa biblioteket och mutera konfigurationen — den räknar aldrig geometri och kan inte hitta på priser. Varje maskins fullständiga beskrivning ur katalogen ligger i systemprompten, så assistenten vet vad maskinerna faktiskt gör. |
| **Admin-vy** | `/admin` — maskinbibliotek, prisbok och konton. Per maskin: identitet, AI-beskrivning, geometri, maskinzon, portar med live-förhandsgranskning, zoner, kapacitet, media, beroenden, kundens inställningar, bilder, optioner och pris. Provkoppling testar att portarna går att koppla in. Export och import av hela biblioteket som JSON. |
| **Grenar** | Linjen är ett träd: en maskin med flera utgångar kan bära en egen gren på var och en. Markera maskinen, tryck **Bygg vidare** på en ledig utgång och välj nästa maskin — grenen får en egen rad i linjeremsan med sitt fäste utskrivet. Grenar delar hinderlista med huvudlinjen så de lägger sig fritt, och tas roten bort följer grenen med. Lagras platt: listan behåller ordningen för offert och ångra, trädet ligger i länkarna. |
| **Flera utgångar** | En maskin kan ha flera utportar — en rullbana lämnar paketet rakt fram eller ut på kortsidan. Vilken linjen fortsätter ur väljs per maskin i konfiguratorn, inte i biblioteket: samma rullbana kan gå rakt i ett flöde och vinkla i ett annat. De andra utgångarna finns kvar och ritas ut. |
| **Maskinzon** | Fritt utrymme runt varje maskin, satt per sida av admin. Solvern håller avstånden när linjen läggs ut och regel R-106 fångar intrång. |
| **Kundens inställningar** | Admin definierar per maskin vilka fält kunden ser — tal, lista eller ja/nej. En talparameter kan styra kapacitet eller mått direkt i motorn, och alla kan bära pris. Exempel ur biblioteket: önskad virkestakt, ströets dimensioner, hydraulversion, presstryck. |
| **Start- och slutpunkt** | Dras direkt i ritningen eller skrivs in i meter. Slås "anpassa längden automatiskt" på sätter solvern sista kedjetransportörens längd så att linjen slutar exakt i punkten. |
| **Maskinzon** | Fritt utrymme per sida — fram, bak, vänster, höger — i maskinens eget system, vridet ut i världen med maskinen. De fyra måtten får skilja sig och gör det: en bred sidozon knuffar inte nästa maskin i kedjan framåt. |
| **Ritade objekt** | Väggar, portar, truckgator och no-go-zoner. Väggar och portar låses till närmaste axel så att de blir raka i både x- och y-led, med måttet utskrivet medan du drar. Allt går också att skriva in exakt i inspektorn, vrida 90° och namnge. |
| **Truckgatan** | Ritas av kunden och hänger inte ihop med linjens längd. Det kan vara en hel gata längs anläggningen eller bara en hämtzon vid utlastningen, och flera zoner samtidigt. Reglerna arbetar mot de ritade zonerna. |
| **Virkesbredd** | Anges som intervall. Regel R-304 kontrollerar att varje maskinport täcker hela spannet, inte bara ett värde. |
| **CAD-vy** | Planvy och isometrisk 3D i SVG. Drag med snapp, rita väggar och no-go-zoner, måttband, zoom, zoner, portar, måttsättning och diagnostik förankrad i geometrin. |
| **CAD-kedja** | Välj maskinens STEP-fil i admin — den tessellereras och komprimeras **i webbläsaren**, i en web worker, och bara den färdiga GLB:n sparas. Filen lämnar aldrig datorn, och en tung konvertering kan inte fälla webbservern. **Måtten ur modellen tas över automatiskt** — modellen är ritningen, och biblioteket ska följa konstruktionen. Portarna skalas med. Går måtten inte att spara ändras ingenting och panelen säger varför. Samma konvertering finns som `scripts/step-to-glb.mjs`. `tests/pipeline.test.ts` och `tests/models.test.ts` kör den skarpt mot en riktig STEP vid varje testkörning. |
| **Utföranden** | Samma maskin i olika längder — en rullbana som 3, 6 och 12 m är en maskin med tre mått, inte tre maskiner. Varje utförande bär sin egen STEP-fil, och måtten kommer ur den. Kunden väljer utförande i konfiguratorn; solvern, reglerna, priset och 3D-vyn ser bara en maskin med sina mått. Priset per utförande ligger i prisboken, aldrig i maskindatan. Utföranden slår steglös längd när en maskin har båda. |
| **Vyn Modell** | three.js, lat laddad. En modell per SKU, instansierad. Maskiner utan modell ritas som fotavtryck. Ritar modellen i **sin verkliga storlek** — den skalas aldrig för att fylla ut ett mått i biblioteket — och **varnar när måtten inte stämmer** — 3D blir en kontroll av datan, inte bara en bild. Säger också till när en modellfil inte gick att hämta, i stället för att tyst rita en låda. |
| **Modellens riktning** | En STEP kommer sällan in rättvänd, men konventionen hör till CAD-systemet och inte till maskinen: en rullbana och en lättpress ser inget lika ut och ritas ändå likadant. Riktningen är därför **en inställning för hela biblioteket** (INKAB:s CAD: X tvärs, Y upp, Z i flödet) som varje ny modell tolkas med. Per maskin går den att ändra, med en 3D-förhandsgranskning som visar ändringen direkt — ingen ny konvertering behövs. |
| **Peka ut flödet** | Följer en fil inte husets konvention behöver ingen räkna på axlar: klicka på modellen där paketen kommer in och där de går ut, så sätts både vändningen och portarna. Vridningstabellen är korskontrollerad mot den riktiga rotationsmatrisen i test. |
| **Offertunderlag** | Ett dokument satt för A4, inte en skärmvy: titelblock med underlagsnummer, datum och giltighet, ifyllbara kundfält, **planritning med måttsättning, skalstock, flödespil och positionsnummer som pekar in i maskinlistan**, maskinlista med mått, tekniska förutsättningar, flödesval och avgränsningar. Sidfoten upprepas på varje sida och tabellhuvudet följer med över sidbrytningen. |
| **Underlagsnummer** | Räknas ur konfigurationen, inte ur en räknare: samma anläggning ger alltid samma nummer, och ändras linjen ändras numret. Ett papper och en konfiguration kan alltså inte glida isär i tysthet. Kundfält och projektnamn påverkar det inte. |
| **Delningslänk** | Hela konfigurationen ligger gzip-komprimerad i adressen — inget sparas på servern och mottagaren behöver inget konto. En trasig eller föråldrad länk säger till i klartext i stället för att tyst visa standardkonfigurationen, adressraden städas efter laddning, och utkastet länken skrev över går att hämta tillbaka. |
| **Export** | Maskinlistan som CSV för svensk Excel och planritningen som DXF (R12, millimeter) med hall, maskiner, maskinzoner, truckgator och flöde på egna lager. Filnamnen bär underlagsnumret. |
| **Övrigt** | Ångra/gör om, autospar, fyra startmallar, tangentbordsgenvägar. |

### Inte byggt — och medvetet så

| Del | Varför |
|---|---|
| **Verifierade mått** | Maskinerna kommer ur er katalog, men den anger inga fotavtryck. Längd, bredd, höjd, portlägen och kapacitet är uppskattade. Varje maskin har en flagga `dimensionsVerified` — bocka i den i admin-vyn när måtten är kontrollerade mot ritning. Tills dess varnar både inspektorn och admin-listan. |
| **Verkliga priser** | Katalogen anger inga priser. Siffrorna i `src/lib/server/pricebook.ts` är påhittade och redigeras i admin-vyn. |
| **STEP-filer** | Knappen finns och förklarar vad som skulle hända. Inga CAD-filer levereras. |
| **Auth.js** | Konton är riktiga — e-post, scrypt-hashade lösenord, HMAC-signerad sessionscookie — men lösenordshanteringen ligger i appen. Ska bli magisk länk för kund och Entra ID internt. |
| **Sparade projekt** | Konfigurationen lever i webbläsaren och i delningslänken. Kontot bär roll, inte projekt. Ingen offerthistorik. |
| **Server-renderad PDF** | PDF:en görs med webbläsarens utskrift, satt för A4 och verifierad genom att faktiskt skriva ut dokumentet i Chromium. Ett serverrenderat alternativ behövs först när underlag ska genereras utan en webbläsare — massutskick eller schemalagd rapportering. |
| **Maskinmodeller** | CAD-kedjan är byggd och körs (STEP-uppladdning i admin, `scripts/step-to-glb.mjs`, vyn **Modell**), men inga verkliga maskinmodeller är framtagna. `public/models/exempel.glb` visar att den fungerar. Se [`docs/cad-pipeline.md`](docs/cad-pipeline.md). |

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
scripts/
├── copy-occt-wasm.mjs    Kopierar OpenCascades wasm till public/ före bygget
└── step-to-glb.mjs       STEP → GLB + katalogkort (CLI runt src/lib/cad/stepConvert.ts)
src/
├── lib/
│   ├── types.ts          Domänmodellen
│   ├── geometry.ts       Rotation, spegling, boxar, snitt
│   ├── projection.ts     Isometrisk projektion och dess invers
│   ├── library.ts        Maskinbibliotek ur produktkatalogen (mått uppskattade)
│   ├── machineSchema.ts  Validering av admin-redigerad maskindata
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
│       ├── auth.ts       Konton, scrypt, signerad sessionscookie
│       ├── store.ts      Bibliotek och konton: seed → Postgres → minne
│       └── context.ts    Det aktiva biblioteket och prisboken
├── components/           Skal, sidebar, CAD-vy, modellvy, inspektor, offert
│   └── admin/            Maskinformulär, parametrar, bilder, prisbok, konton
├── store/                Zustand med historik och autospar
└── app/
    ├── page.tsx
    ├── admin/            Admin-vyn
    └── api/              ai/chat · price · library · models · auth · admin (library, model, users) · health
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
| R-106 | Maskinzonen inkräktad av annan maskin eller ritat objekt | fel |
| R-201 | Truckgatan ligger utanför hallen, eller är smalare än 3,5 m | fel / varning |
| R-202 | Sista transportören rymmer inte två pakets buffert | varning |
| R-203 | Pulpet eller magasin står i truckgatan | fel |
| R-204 | Trucken måste korsa flödet för att nå magasinet | varning |
| R-205 | Ingen truckgata eller hämtzon är ritad | varning |
| R-206 | Linjen slutar inte vid den angivna slutpunkten | varning |
| R-207 | Truckgatan ansluter inte till någon av hallens portar | varning |
| R-301 | Kapaciteten understiger målet | varning |
| R-302 | Paketets mått ligger utanför maskinens intervall | fel |
| R-303 | Paketet är för tungt | fel |
| R-304 | Porten täcker inte hela virkesbreddsintervallet | varning |
| R-401 | Maskinen hamnar utanför hallen | fel |
| R-402 | Maskinen är högre än fri höjd | fel |
| R-403 | Kollision med ritad vägg eller no-go-zon | fel |
| R-404 | Maskinen står i en truckgata | fel |
| R-501 | Beroende saknas eller maskiner kan inte kombineras | fel |
| R-601 | Ovanlig ordning i kedjan | info |

20 regler. 

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
| `1` / `2` / `3` | Planvy / isometrisk vy / modellvy |
| `V` `W` `D` `T` `N` `M` | Markera · vägg · port · truckgata · no-go · mät |
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
- **Schemabegränsning.** Med `strict: true` tar Messages API inte emot
  `minimum`, `maximum`, `multipleOf`, `minLength` eller `maxLength`. Intervallen
  står därför i verktygens beskrivningar och klipps i `executeTool`.
  `tests/ai-tools.test.ts` vaktar att inget otillåtet nyckelord smyger in — ett
  sådant fel syns annars först i produktion, som ett 400 från Anthropic.
- **Degraderar rent.** Utan nyckel, vid API-fel eller vid ett avböjt svar
  fortsätter verktyget att fungera fullt ut.

Systemprompten har en cache-brytpunkt efter maskinbiblioteket; konfigurationen
och frågan ligger efter den så att cachen inte invalideras vid varje anrop.

---

## Admin-vyn

`/admin`, för konton med rollen admin.

**Maskiner.** Hela biblioteket, grupperat per kategori. Per maskin redigeras
identitet och katalognummer, den utförliga beskrivningen som assistenten läser,
geometri, maskinzon, portar, zoner, kapacitet, media och fundament, beroenden,
kundens inställningar, bilder och kataloglänkar, optioner och pris.
Förhandsgranskningen till höger ritar fotavtryck, portar och zoner medan du
skriver — det är där man ser om en port hamnat på fel kant. **Provkoppla**
kopplar maskinen efter en annan i motorn och rapporterar om det fungerar.

**Prisbok.** Montagepåslag per kategori, el- och styrpåslag, frakt och det
intervall som visas publikt.

**Konton.** Roller och borttagning. Adresser i `ADMIN_EMAILS` är låsta som admin —
som standard robin@, daniel@ och lars@inkab.nu.

**Export och import.** *Exportera JSON* laddar ner hela biblioteket. Lägg filen
som `data/library.json` i repot och committa den — då blir den det
versionshanterade utgångsläget som gäller vid varje deploy, oavsett databas.
Det är den arbetsgången jag rekommenderar för maskindata: granskningsbar i en
pull request, med full historik.

**Lagring.** Med `DATABASE_URL` sparas ändringar i Postgres. Utan den lever de
i serverns minne tills den startar om — banderollen högst upp säger vilket som
gäller.

---

## Nästa steg

1. **Fyll i de verkliga måtten.** Katalogen gav er maskiner och beskrivningar,
   men inte fotavtryck. Gå igenom maskinerna i admin-vyn, mata in längd, bredd,
   höjd, portlägen och kapacitet, och bocka i *måtten är kontrollerade*.
   Exportera JSON och committa den när ni är klara.
2. **Sätt riktiga priser** i prisboken.
3. **Håll workshop om flödesreglerna** med konstruktörerna och skriv om
   `rules.ts` efter vad som faktiskt gäller. Reglerna är produkten.
4. **Låt tre konstruktörer testa** och räkna hur ofta de säger "så gör vi
   aldrig". Det talet är prototypens verkliga betyg.
5. Därefter fas 2 enligt [`docs/forslag.md`](docs/forslag.md): sparade projekt,
   offerthistorik, STEP-leverans.
