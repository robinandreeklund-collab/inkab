# INKAB Layout Configurator

**Webbaserat AI-verktyg för konfigurering och visualisering av pakethanteringsanläggningar.**

> **Status: FÖRSLAG / FÖRSTUDIE.** Detta dokument är ett komplett lösningsförslag —
> ingen kod är byggd ännu. Det är skrivet för att kunna läsas av både ledning
> (kapitel 1–6, 22–25) och utvecklare (kapitel 7–21).

---

## Innehåll

1. [Sammanfattning](#1-sammanfattning)
2. [Bakgrund och mål](#2-bakgrund-och-mål)
3. [Underlag och antaganden](#3-underlag-och-antaganden)
4. [Produktkoncept](#4-produktkoncept)
5. [Användare och scenarier](#5-användare-och-scenarier)
6. [Helskärmslösningen — UI-brainstorm](#6-helskärmslösningen--ui-brainstorm)
7. [Maskinbiblioteket — kärntillgången](#7-maskinbiblioteket--kärntillgången)
8. [Konfigurationsmodellen](#8-konfigurationsmodellen)
9. [Layoutmotorn](#9-layoutmotorn)
10. [Regelverket](#10-regelverket)
11. [AI-arkitektur (Claude)](#11-ai-arkitektur-claude)
12. [Prissättning](#12-prissättning)
13. [CAD-pipeline och STEP-hantering](#13-cad-pipeline-och-step-hantering)
14. [Offertunderlag och PDF](#14-offertunderlag-och-pdf)
15. [Inloggning och roller](#15-inloggning-och-roller)
16. [Teknikval](#16-teknikval)
17. [Datamodell](#17-datamodell)
18. [API-ytor](#18-api-ytor)
19. [Säkerhet, IP och GDPR](#19-säkerhet-ip-och-gdpr)
20. [Prestanda](#20-prestanda)
21. [Kostnadsbild](#21-kostnadsbild)
22. [Roadmap](#22-roadmap)
23. [Mätetal](#23-mätetal)
24. [Risker](#24-risker)
25. [Öppna frågor till INKAB](#25-öppna-frågor-till-inkab)
26. [Föreslagen repo-struktur](#26-föreslagen-repo-struktur)
27. [Källor](#27-källor)

---

## 1. Sammanfattning

Kunden går in på inkab.nu, klickar "Konfigurera din anläggning" och landar i en
helskärmsapplikation. Till vänster en sidebar med maskinkatalog och en
stegvis guide. Till höger en stor CAD-vy där anläggningen byggs upp i realtid
i 2D-planvy och 3D. Kunden väljer maskiner, svarar på fem flödesfrågor
(inmatningsriktning, pulpetsida, ströfacksida, trucksida, längd sista
kedjetransportör) och ser layouten byggas.

En **deterministisk layoutmotor** placerar maskinerna — inte AI:n. AI:n
(Claude) sitter ovanpå som resonemangs- och dialoglager: den tolkar kundens
fritext, förklarar varför en layout inte fungerar, föreslår konkreta
alternativ och skriver utkast till offerttext. Den kan **inte** hitta på
maskiner eller priser — den når bara verktyg som läser ur maskinbiblioteket
och muterar konfigurationen, varefter den deterministiska motorn räknar om.

Resultatet exporteras som måttsatt PDF-offertunderlag och — för inloggad
kund — STEP-filer på de valda maskinerna.

**Den viktigaste designprincipen i hela förslaget:**
> Geometri och pris är deterministiska. AI:n resonerar, förklarar och föreslår —
> den räknar aldrig och placerar aldrig själv.

Det är skillnaden mellan ett verktyg som säljaren vågar skicka till kund och
en demo som ser imponerande ut i tre minuter.

---

## 2. Bakgrund och mål

INKAB (Ingenjörsfirma Nybergs Konstruktion AB, Hjo) arbetar med automation
inom sågverksindustrin. Pakethantering — allt som händer med paketet efter
sorterings-/ströläggningslinjen fram till att trucken hämtar det — är ett
område där varje anläggning i praktiken är ett specialbygge, men där
byggstenarna och flödesreglerna är i hög grad återkommande.

### Mål med verktyget

| Mål | Hur verktyget levererar |
|---|---|
| Snabbare offertprocess | Kunden bygger själv 80 % av underlaget innan första mötet |
| Bättre kundupplevelse | Kunden ser sin anläggning i 3D samma kväll som hen hittade er |
| Fler kvalificerade förfrågningar | Förfrågan kommer in med maskinval, flöde och mått — inte "hej, vad kostar en linje?" |
| Minskad konstruktionsinsats tidigt | Konstruktör slipper rita förstudielayouter i CAD för förfrågningar som ändå inte blir affär |
| Effektivare försäljning | Säljaren öppnar kundens konfiguration, justerar, trycker på PDF |

### Vad verktyget INTE är

Detta måste vara tydligt både internt och mot kund, annars blir det en
juridisk och teknisk fälla:

- Det är **inte** en bindande offert. Priset är en indikation.
- Det ersätter **inte** konstruktören. Verklig anläggning kräver
  platsbesök, hallmätning, elprojektering och riskanalys.
- Det är **inte** en CAD-modell för produktion. STEP-filerna är
  förenklade envelope-modeller för layoutarbete.

Positionera det som **"digital förstudie på 15 minuter"**. Det är starkt nog.

---

## 3. Underlag och antaganden

### Vad jag kunde undersöka

Jag försökte hämta www.inkab.nu direkt, men domänen **blockeras av
sessionens egress-policy** (proxyn svarar 403 på CONNECT). Jag har därför
byggt domänbilden på:

- Sökresultat som beskriver INKAB som "ingenjörsfirma Nybergs konstruktion —
  automation inom sågverksindustrin", Industrigatan 46, Hjo, info@inkab.nu
- Branschmaterial om ströläggning, paketläggare, kedjetransportörer och
  råsortering från Almab, Renholmen, CGV, Framtec, Roséns m.fl.
- Din kravspecifikation i uppdraget

### Konsekvens

Maskinlistan i kapitel 7 är ett **branschgeneriskt förslag**, inte er
faktiska produktportfölj. Den är det första som behöver ersättas med er
verkliga data — se [öppna frågor](#25-öppna-frågor-till-inkab). Allt annat i
dokumentet (arkitektur, UI, regelmotor, AI-design) är oberoende av vilka
maskiner det till slut blir.

### Antaganden jag gjort

| # | Antagande | Påverkan om fel |
|---|---|---|
| A1 | Anläggningen är i grunden en **kedja** av moduler, inte ett nät | Layoutmotorn i kap. 9 måste generaliseras till graf |
| A2 | Paketen är kolli av sågat virke, standardformat, hanteras liggande | Portmodellen behöver fler dimensionsparametrar |
| A3 | Kunden känner till sin hall (längd, bredd, takhöjd, pelarraster) | Hallmodulen blir "valfri" i stället för central |
| A4 | Priser finns per maskin + optioner, inte per projekt | Prismodellen i kap. 12 behöver kalkylregler i stället |
| A5 | STEP-filer finns redan per maskin i något CAD-system | Fas 0 blir betydligt längre |
| A6 | Svenska är huvudspråk, engelska behövs på sikt | Endast i18n-uppsättningen påverkas |

---

## 4. Produktkoncept

```
  Kund på inkab.nu
        │
        ▼
  ┌─────────────────────────────────────────────────────┐
  │  KONFIGURATOR  (helskärm)                           │
  │                                                     │
  │  Välj maskiner  →  Svara på flödesfrågor            │
  │        │                    │                       │
  │        ▼                    ▼                       │
  │   ┌────────────────────────────────┐                │
  │   │  LAYOUTMOTOR (deterministisk)  │                │
  │   │  portmatchning · spegling ·    │                │
  │   │  zoner · kollision             │                │
  │   └───────────┬────────────────────┘                │
  │               ▼                                     │
  │   ┌────────────────────────────────┐                │
  │   │  REGELMOTOR → Diagnostik       │                │
  │   └───────────┬────────────────────┘                │
  │               ▼                                     │
  │   ┌────────────────────────────────┐                │
  │   │  CAD-VY (2D/3D) + STATUSRAD    │                │
  │   └───────────┬────────────────────┘                │
  │               │                                     │
  │        ┌──────┴──────┐                              │
  │        ▼             ▼                              │
  │  ┌──────────┐  ┌──────────────┐                     │
  │  │ CLAUDE   │  │ EXPORT       │                     │
  │  │ förklarar│  │ PDF · STEP · │                     │
  │  │ föreslår │  │ offertunder- │                     │
  │  │ skriver  │  │ lag · länk   │                     │
  │  └──────────┘  └──────┬───────┘                     │
  └───────────────────────┼─────────────────────────────┘
                          ▼
                 INKAB säljare / CRM
```

---

## 5. Användare och scenarier

### Persona 1 — "Produktionschefen på sågverket"

Vet exakt vad hen vill ha ("vi behöver en truckströläggare och 12 meter
utmatning"), men vill inte ringa fyra leverantörer för att få veta
prisnivån. Sitter på kontoret, dubbelskärm, har hallritningen i en PDF
bredvid.

**Scenario:** Bygger linjen på 12 minuter, ser att den blir 3 m för lång
för hallen, låter AI:n föreslå hur den kortas, laddar ner PDF, skickar
förfrågan.

### Persona 2 — "Teknikchefen som orienterar sig"

Har ett vagt behov, vet inte terminologin. Behöver bli guidad.

**Scenario:** Startar i AI-läget: *"Vi har en råsorteringslinje och lägger
strö manuellt idag. Vill automatisera."* Claude ställer följdfrågor, fyller
konfigurationen, kunden ser resultatet växa fram.

### Persona 3 — INKAB:s säljare

**Scenario:** Får notis om ny konfiguration. Öppnar den i säljläge (ser
inköpspris och marginal), justerar två maskiner, byter från indikativt till
skarpt pris, genererar offert-PDF med INKAB:s villkor.

### Persona 4 — INKAB:s konstruktör

**Scenario:** Underhåller maskinbiblioteket. Laddar upp ny STEP + mått +
portdefinition, sätter pris, publicerar. Ser statistik på vilka maskiner som
väljs oftast.

---

## 6. Helskärmslösningen — UI-brainstorm

### 6.1 Grundlayout

Applikationen tar hela viewporten. Ingen sidscroll någonsin. Tre kolumner
plus topbar och statusrad.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⬛ INKAB   Projekt: "Sågverk Nord – linje 2" ▾    [2D│3D]  [m│mm]   ⚙  👤 Logga in │
├────────────────┬──────────────────────────────────────────────┬──────────────┤
│                │                                              │              │
│  ① MASKINER    │                                              │  INSPEKTOR   │
│  ─────────     │                                              │  ─────────   │
│  🔍 Sök...     │                                              │  Truckströ-  │
│                │            C A D - V Y                       │  läggare TS4 │
│  ▸ Inmatning   │                                              │              │
│  ▸ Ströläggning│      ┌───┐ ┌────┐ ┌──┐ ┌─────────┐          │  Magasinsida │
│  ▸ Transport   │   →  │ 1 │→│ 2  │→│3 │→│    4    │ →        │  ◉ Höger     │
│  ▸ Press/band  │      └───┘ └────┘ └──┘ └─────────┘          │  ○ Vänster   │
│  ▸ Utlastning  │              ▲                               │              │
│  ▸ Övrigt      │            ⚠ 2                               │  Kapacitet   │
│                │                                              │  22 pkt/h    │
│  ② LINJEN      │      ░░░ truckgata 5,0 m ░░░                │              │
│  ─────────     │                                              │  Optioner    │
│  ⠿ 1 Inmatning │                                              │  ☑ Extra fack│
│  ⠿ 2 Ströläggr │                                              │  ☐ Servotrim │
│  ⠿ 3 Press     │  ┌─────────────────────────────────────┐    │              │
│  ⠿ 4 Kedjetr.  │  │ 🤖 Fråga om placering...        ▲ │    │  Pris        │
│    12,0 m      │  └─────────────────────────────────────┘    │  Se pris →   │
│                │                                              │              │
│  ③ FLÖDE       ├──────────────────────────────────────────────┤              │
│  ④ OFFERT      │ ▬▬▬▬ LINJEREMSAN ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬  │              │
├────────────────┴──────────────────────────────────────────────┴──────────────┤
│ 📏 L 42,3 m · B 11,2 m · H 4,1 m  │  ⚡ 18 pkt/h  │  ⚠ 2 varningar  │  ~1,8 Mkr │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Vänster sidebar — fyra sektioner, alltid synliga

**① Maskinkatalog.** Grupperad per kategori, kollapsbar. Varje maskin är ett
kort med miniatyrrendering, namn och nyckeltal (kapacitet, längd). Dra kortet
till CAD-vyn eller till linjelistan, eller dubbelklicka för att lägga sist.

**② Linjen.** Den valda kedjan som en omordningsbar lista. **Detta är
kundens mentala modell** — en linje är en sekvens. Dra för att byta ordning;
CAD-vyn räknar om direkt. Rader visar varningsbadge och parameter
(t.ex. "12,0 m") inline.

**③ Flöde.** De fem konfigurationsfrågorna. Inte radioknappar — **stora
piktogramknappar med pilar** som visar riktningen, med hover-preview i
CAD-vyn.

**④ Offert.** Summering, kontaktuppgifter, exportknappar.

### 6.3 CAD-vyn — höger, stor

- **2D-planvy är default.** Fabrikslayout är ett topvyproblem; 3D är för
  försäljning och förståelse, 2D är för beslut. Växla med `Tab` eller
  segmented control i topbaren. Samma three.js-scen, ortografisk kamera
  uppifrån i 2D-läget — inga två renderare att underhålla.
- **Rutnätsgolv** med 1 m-raster, måttlinjer på totalytterlinjen.
- **Zoner ritas ut**: servicezoner (blå raster), säkerhetszoner (gul),
  truckgata (grå med riktningspilar och svängradie), gropar (streckad).
- **Kollisioner och regelbrott markeras i geometrin**, inte bara i en lista:
  röd kontur på maskinen + en badge som svävar ovanför. Klick på badgen →
  kameran flyger dit och Claude förklarar.
- **Flödesriktning** som animerade pilar mellan portar.

### 6.4 Höger inspektor — utfällbar

Egenskaper för markerad maskin: mått, kapacitet, handedness-växel, optioner
med prispåverkan, media (rendering, ritning, STEP-nedladdning), och en
"Ersätt med…"-lista över kompatibla alternativ.

Panelen är utfällbar så att CAD-vyn kan gå till nästan full bredd
(`F` = fokusläge, döljer båda sidopanelerna).

### 6.5 Statusraden — undertill, alltid

Total längd/bredd/höjd, kapacitet (paket/h, dimensionerande flaskhals),
antal varningar, prisindikation. Klick på varningssiffran öppnar
diagnostiklistan.

### 6.6 Linjeremsan

En horisontell remsa längst ner i CAD-vyn med maskinerna i ordning som
ikoner med flödespilar. Klick markerar, drag omordnar, hover visar
kapacitet. Fungerar som "tidslinje" för anläggningen och är samma data som
sidebarens sektion ②, men i CAD-vyns kontext så att man slipper flytta
blicken.

### 6.7 AI-panelen

Dockad nedtill i CAD-vyn som ett collapsat promptfält. Expanderar uppåt
till en chatt som täcker nedre tredjedelen — **aldrig en modal som döljer
vyn**, för hela poängen är att se effekten medan man pratar.

AI:ns förslag presenteras som **klickbara kort**, inte som text:

```
┌────────────────────────────────────────────────────┐
│ 💡 Förslag 1 — Spegla linjen                       │
│ Truckgatan hamnar då mot port A i stället för mot  │
│ kontorsväggen. Linjen blir 0 m kortare.            │
│                                                    │
│ Längd 42,3 → 42,3 m   Pris oförändrat  ⚠ 2 → 0    │
│                            [Förhandsgranska] [Använd]│
└────────────────────────────────────────────────────┘
```

"Förhandsgranska" visar ändringen som ghost i CAD-vyn utan att applicera.
"Använd" gör en atomär, ångerbar ändring.

### 6.8 Idébank — interaktioner som gör skillnad

Sorterad efter (min bedömning av) värde delat med insats:

| # | Idé | Varför | Insats |
|---|---|---|---|
| 1 | **Speglingsknapp** — spegla hela linjen med ett klick | Halva flödesfrågorna handlar om höger/vänster. En knapp gör det begripligt. | Låg |
| 2 | **Hallmått-overlay** — mata in L×B×H + pelarraster, visas som gräns, blir röd när linjen inte får plats | Detta är kundens verkliga fråga | Låg |
| 3 | **Truckgatevisualisering** med svängradie | Det är truckens väg som i praktiken avgör layouten | Låg |
| 4 | **Måttband** — klicka två punkter, få avstånd | Alla i branschen vill mäta i en ritning | Låg |
| 5 | **Ghost-preview** vid hover i katalogen | Gör "vad händer om" gratis | Låg |
| 6 | **Delningslänk** — kort URL till exakt konfiguration, skrivskyddad kundvy | Säljaren och kunden tittar på samma sak | Låg |
| 7 | **Flödesanimation** — ett paket åker genom linjen | Enorm säljeffekt, tekniskt en tween längs en path | Medel |
| 8 | **Diagnostik förankrad i 3D** + "Varför?"-knapp till Claude | Gör felmeddelanden begripliga för icke-konstruktörer | Medel |
| 9 | **Jämförelseläge A/B** — delad skärm, diff på pris/yta/kapacitet | Hjälper kunden bestämma sig | Medel |
| 10 | **Kameraförval** (Topp / ISO / Inmatning / Utlastning) som också används i PDF:en | Konsekventa vyer i offerten | Låg |
| 11 | **Hallunderlag** — ladda upp PDF/DWG av hallritning, georeferera med två punkter | Kunden ritar in i sin egen hall | Hög |
| 12 | **Snapping** — maskiner snappar till portar och till hallens pelarraster | Känns "rätt" i handen | Medel |
| 13 | **Ångra/gör om** med full historik, `Ctrl+Z` | Uppmuntrar experimenterande | Låg |
| 14 | **Tangentbordsgenvägar** — `1-4` vyer, `G` grid, `M` mät, `F` fokus, `Del` ta bort | Proffskänsla | Låg |
| 15 | **Autospar till localStorage** + "återuppta din konfiguration" | Ingen förlorar 20 minuters arbete | Låg |
| 16 | **Kapacitetsflaskhals markerad** — den långsammaste maskinen får en etikett | Pedagogiskt, säljer uppgraderingar | Låg |
| 17 | **Mobil = skrivskyddad viewer** + "begär offert" | Redigering på mobil är en fälla, bygg den inte | Låg |
| 18 | **"Börja från mall"** — 3–4 typiska linjer att utgå ifrån | Blank sida är den största avhopps­orsaken | Låg |
| 19 | **Enhetsväxel m/mm** och tum för export | Sågverk internationellt | Låg |
| 20 | **Skärmdump-knapp** som ger PNG med måttsättning | Kunden klistrar in i sitt eget material | Låg |

### 6.9 Onboarding-flödet

Blank sida dödar konverteringen. Första skärmen ska vara ett val mellan tre
vägar, inte en tom CAD-vy:

```
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │ 🏗            │   │ 🤖            │   │ 📐            │
   │ Börja från    │   │ Beskriv med   │   │ Bygg från     │
   │ en mall       │   │ egna ord      │   │ grunden       │
   │               │   │               │   │               │
   │ 4 vanliga     │   │ AI:n ställer  │   │ Tom canvas,   │
   │ linjer        │   │ frågorna      │   │ full kontroll │
   └──────────────┘   └──────────────┘   └──────────────┘
```

---

## 7. Maskinbiblioteket — kärntillgången

**80 % av arbetet i det här projektet är data, inte kod.** Det underskattas
alltid. Maskinbiblioteket är det som gör verktyget värt något och det som
INKAB äger; koden runt omkring är utbytbar.

### 7.1 Schema

```ts
type Machine = {
  id: string;                    // "ts4-truckstrolaggare"
  sku: string;
  name: { sv: string; en: string };
  category: MachineCategory;
  summary: { sv: string; en: string };
  status: "active" | "legacy" | "concept";

  geometry: {
    // Lokalt koordinatsystem: X = flödesriktning, Y = tvärled, Z = höjd.
    // Origo i infeed-portens golvpunkt.
    footprint: { length: number; width: number; height: number };  // mm
    ports: Port[];
    handedness: "none" | "left" | "right" | "mirrorable";
  };

  zones: Zone[];                 // service, safety, truck, pit

  capacity: {
    packagesPerHour: number;
    package: {
      lengthMm: [min: number, max: number];
      widthMm:  [min: number, max: number];
      heightMm: [min: number, max: number];
      maxWeightKg: number;
    };
  };

  utilities: {
    powerKw: number;
    airNlPerMin?: number;
    hydraulic?: boolean;
    controlCabinet?: "integrated" | "separate";
  };

  foundation: {
    pitDepthMm?: number;         // grop
    pointLoadKn?: number;
    boltPattern?: string;
  };

  assets: {
    thumbnail: string;           // webp
    glb: string;                 // web-3D, Draco-komprimerad
    stepFileId: string;          // gated nedladdning
    drawingPdf?: string;
    photos?: string[];
  };

  pricing: {
    basePrice: number;           // SEK, listpris
    currency: "SEK" | "EUR";
    validUntil: string;
    options: MachineOption[];
    installFactor?: number;      // andel av basePrice för montage
  };

  leadTimeWeeks: number;
  requires?: string[];           // maskin-id som måste finnas i linjen
  conflictsWith?: string[];
  documentation?: string[];      // för AI:ns RAG-index
};

type Port = {
  id: string;
  role: "in" | "out";
  position: [x: number, y: number, z: number];   // mm i lokalt system
  direction: "x+" | "x-" | "y+" | "y-";
  level: number;                                  // mm över golv
  productWidthMm: [min: number, max: number];
  allowsDirectionChange: boolean;                 // t.ex. tvärtransportör
};

type Zone = {
  type: "service" | "safety" | "truck" | "pit" | "reserved";
  box: { x: number; y: number; z: number; l: number; w: number; h: number };
  label: { sv: string; en: string };
  mayOverlapWith?: Zone["type"][];
};

type MachineOption = {
  id: string;
  name: { sv: string; en: string };
  priceDelta: number;
  affects?: Partial<Pick<Machine, "geometry" | "capacity" | "utilities">>;
  excludes?: string[];
};
```

### 7.2 Kategorier (förslag — bekräfta mot er portfölj)

| Kategori | Exempel på maskiner |
|---|---|
| `infeed` | Inmatningsbord, uppfordrare, paketmottagning |
| `stacking` | Paketläggare, stapelbord, sekundärhiss |
| `stickers` | Ströläggare, truckströläggare, ströretur, ströhiss, ströhäck |
| `transport` | Kedjetransportör, tvärtransportör, rullbana, lyftbord, paketvändare |
| `processing` | Paketpress, paketkap, paketvåg, mätstation |
| `finishing` | Bandningsmaskin, emballering, etikettering/märkning |
| `outfeed` | Utlastningsbana, avlämningsbord, truckficka |
| `control` | Manöverpulpet, operatörshytt, apparatskåp |

### 7.3 Redaktionellt gränssnitt

Konstruktören ska kunna underhålla biblioteket utan utvecklare. Föreslaget:
enkel admin-vy i samma app (`/admin/machines`) med formulär enligt schemat
ovan, uppladdning av STEP + automatisk GLB-konvertering, och en
**portredigerare** — en 3D-vy där man klickar ut var in- och utportarna
sitter på den uppladdade modellen. Portdefinitionen är det som kräver
mänskligt omdöme; allt annat är formulärfält.

---

## 8. Konfigurationsmodellen

De fem frågorna ur kravspecen, plus det som behövs för att en layout ska gå
att räkna på:

```ts
type Configuration = {
  id: string;
  version: number;
  project: {
    name: string;
    customer?: string;
    site?: string;
  };

  // Hallen (valfri men starkt rekommenderad)
  hall?: {
    lengthMm: number;
    widthMm: number;
    clearHeightMm: number;
    columnGridMm?: [x: number, y: number];
    underlayId?: string;         // uppladdad ritning
  };

  // ── De fem frågorna ────────────────────────────────────────
  flow: {
    /** "Kommer paketen in från: Rakt / Höger / Vänster" */
    infeedFrom: "straight" | "right" | "left";

    /** "Vilken sida ska pulpeten stå på" */
    controlDeskSide: "right" | "left";

    /** "Om truckströläggare valts, vilken sida ska magasinet stå på" */
    stickerMagazineSide?: "right" | "left";

    /** "Från vilken sida hämtar trucken färdiga paket" */
    truckPickupSide: "right" | "left";

    /** "Längd på sista kedjetransportören" (meter i UI, mm internt) */
    finalConveyorLengthMm: number;
  };
  // ───────────────────────────────────────────────────────────

  line: LineItem[];              // ordnad kedja

  product: {
    packageLengthMm: number;
    packageWidthMm: number;
    packageHeightMm: number;
    packageWeightKg: number;
    targetPackagesPerHour: number;
  };

  meta: {
    createdAt: string;
    updatedAt: string;
    ownerId?: string;
    locale: "sv" | "en";
  };
};

type LineItem = {
  instanceId: string;
  machineId: string;
  quantity: number;
  selectedOptions: string[];
  parameters?: Record<string, number>;   // t.ex. { lengthMm: 12000 }
  mirrored?: boolean;
  manualOffset?: { x: number; y: number; rotation: 0 | 90 | 180 | 270 };
};
```

**Notera:** `flow.stickerMagazineSide` är villkorad — frågan ställs bara om
linjen innehåller en truckströläggare. UI:t ska dölja frågan helt, inte visa
den gråad.

**Notera 2:** `finalConveyorLengthMm` anges i meter i UI:t men lagras i mm.
All intern geometri i mm, heltal. Flyttal i CAD-sammanhang ger avrundnings-
fel som syns som glipor i modellen.

---

## 9. Layoutmotorn

Ren funktion, inga sidoeffekter, körs på klienten (för direktrespons) och på
servern (för PDF och som sanningskälla). Samma TypeScript-kod på båda
ställen — en delad `packages/layout-engine`.

```ts
function solveLayout(
  config: Configuration,
  library: MachineLibrary
): LayoutResult;

type LayoutResult = {
  placements: Placement[];       // absoluta transformer
  bounds: BoundingBox;
  aisles: Aisle[];
  diagnostics: Diagnostic[];
  metrics: {
    totalLengthMm: number;
    totalWidthMm: number;
    maxHeightMm: number;
    throughputPerHour: number;
    bottleneckInstanceId: string | null;
    footprintM2: number;
  };
};
```

### Algoritm

1. **Normalisera kedjan.** Sortera `line` efter användarens ordning; validera
   att kategoriordningen är rimlig (inmatning före utlastning).
2. **Bestäm global orientering** ur `flow.infeedFrom`. `straight` → linjen
   går i X+. `right`/`left` → första modulen får en 90°-inmatning; kräver att
   modul 0 har en port med `allowsDirectionChange: true`, annars diagnostik
   D-101 med förslag att lägga till en tvärtransportör.
3. **Bestäm handedness.** `flow.controlDeskSide` sätter linjens "operatörssida";
   maskiner med `handedness: "mirrorable"` speglas så att manöversidan hamnar
   rätt. En spegling är en Y-flip plus portomkastning — inte en rotation.
4. **Kedjevandring.** För varje modul *i*: sök porten `out` på modul *i−1* och
   `in` på modul *i*, beräkna transformen som får portarna att sammanfalla och
   riktningarna att bli motsatta. Ackumulera. Vid `allowsDirectionChange`
   tillåts 90°-svängar.
5. **Parametriserade moduler.** Sista kedjetransportören får sin längd ur
   `flow.finalConveyorLengthMm` — dess `out`-port flyttas därefter.
6. **Sidoplacerade objekt.** Pulpeten placeras på `controlDeskSide` vid den
   station som har flest manuella ingrepp (definieras i biblioteket med en
   `operatorPriority`). Ströfacksmagasinet placeras på
   `stickerMagazineSide` intill truckströläggaren.
7. **Truckgata.** Ett `Aisle`-objekt genereras längs `truckPickupSide` från
   utlastningsbanan, med bredd = truckens svängradie × 2 + marginal
   (parameter, default 5 000 mm).
8. **Zoner.** Alla maskiners zoner transformeras till världskoordinater.
9. **Regelmotor** (kap. 10) körs på resultatet → `Diagnostic[]`.
10. **Mätvärden** beräknas; flaskhalsen är `min(packagesPerHour)` över kedjan.

### Varför inte låta AI:n göra detta

- Determinism: samma input ska ge samma layout, varje gång, för alltid.
  En offert som ändrar sig mellan två körningar är värdelös.
- Precision: millimeter. LLM:er räknar inte geometri tillförlitligt.
- Hastighet: motorn körs vid varje knapptryck, ~1 ms. Ett API-anrop tar sekunder.
- Kostnad: gratis.
- Testbarhet: rena funktioner med snapshot-tester.

AI:ns roll börjar där determinismen tar slut: vid tolkning, förklaring och
förslag. Se kap. 11.

### Framtid: verklig optimering

Om det senare visar sig att kunderna vill ha *hallanpassad* placering
(flera linjer, U-formad layout runt pelare) är nästa steg en riktig
optimerare — simulated annealing eller MILP över modulplaceringar med
regelverket som constraints. Det är fas 4, inte fas 1, och det är fortfarande
inte AI:ns jobb.

---

## 10. Regelverket

Regler är data, inte kod — de ska kunna justeras av konstruktör utan
deploy. Varje regel producerar `Diagnostic`:

```ts
type Diagnostic = {
  code: string;                             // "R-204"
  severity: "error" | "warning" | "info";
  message: { sv: string; en: string };
  anchors: { instanceId?: string; point?: [number, number, number] }[];
  suggestedFix?: ConfigPatch;               // klickbar i UI:t
  explainable: true;                        // AI får förklara vidare
};
```

### Startregler

| Kod | Regel | Nivå |
|---|---|---|
| R-101 | Utgående port måste matcha nästa moduls ingående port (riktning, nivå ±20 mm, produktbredd) | error |
| R-102 | Riktningsändring kräver modul med `allowsDirectionChange` | error |
| R-103 | Maskingeometrier får inte överlappa | error |
| R-104 | Servicezoner får inte överlappa varandra eller maskinvolymer | warning |
| R-105 | Säkerhetszon får inte skära truckgata | error |
| R-201 | Truckgatan måste ha fri bredd ≥ konfigurerad minsta (default 5 000 mm) | error |
| R-202 | Sista kedjetransportören måste rymma ≥ 2 paketlängder som buffert | warning |
| R-203 | Truckens hämtsida måste vara fri från pulpet och ströfacksmagasin | error |
| R-204 | Ströfacksmagasinet ska nås av truck utan att korsa produktionsflödet | warning |
| R-205 | Pulpeten ska ha fri sikt till ströläggning och utlastning | warning |
| R-301 | Varje moduls kapacitet ≥ `targetPackagesPerHour` | warning |
| R-302 | Paketdimensioner inom varje moduls intervall | error |
| R-303 | Paketvikt inom varje moduls maxvikt | error |
| R-401 | Total layout måste rymmas inom `hall`-måtten | error |
| R-402 | Maskinhöjd + lyfthöjd ≤ hallens fria höjd | error |
| R-403 | Maskiner får inte placeras i pelarraster | warning |
| R-501 | Maskiners `requires` uppfyllda, `conflictsWith` ej brutna | error |
| R-502 | Ströläggare kräver ströretur i linjen | warning |

**Viktigt:** varje `error` ska ha ett `suggestedFix` där det är möjligt.
"Fel: truckgatan är för smal" är värdelöst. "Fel: truckgatan är 3,8 m,
behöver 5,0 m — [Flytta pulpeten till motsatt sida] eller [Korta sista
kedjetransportören till 9 m]" är användbart.

---

## 11. AI-arkitektur (Claude)

### 11.1 Principen

Claude får aldrig producera geometri eller priser i fritext. Den får ett
**verktygsskal** och kör i en agentloop där varje verktyg är en
server-implementerad, validerad funktion. Modellen resonerar; systemet räknar.

```
   Kundens fråga
        │
        ▼
   ┌─────────────────────────────────────────────┐
   │ Claude (claude-opus-5, adaptive thinking)   │
   │                                             │
   │  System:  roll · domänregler · UI-kontext   │  ← cachead prefix
   │  Tools:   ↓                                 │
   └───┬──────────────────────────────────────┬──┘
       │                                      │
       ▼                                      ▼
  ┌─────────────────┐              ┌────────────────────┐
  │ LÄSVERKTYG      │              │ SKRIVVERKTYG       │
  │ get_library     │              │ set_flow           │
  │ get_machine     │              │ add_machine        │
  │ get_config      │              │ remove_machine     │
  │ run_layout      │              │ reorder_line       │
  │ validate        │              │ set_parameter      │
  │ estimate_price  │              │ propose_variant    │
  │ search_docs     │              │                    │
  └─────────────────┘              └────────────────────┘
                    │                       │
                    └───────────┬───────────┘
                                ▼
                    Deterministisk layoutmotor
                                │
                                ▼
                    Strukturerat resultat tillbaka
```

### 11.2 Verktygsdefinitioner

Alla skrivverktyg returnerar det **nya layoutresultatet inklusive
diagnostik**, så att modellen omedelbart ser konsekvensen av sin ändring och
kan korrigera sig själv. Det är samma återkopplingsslinga som en människa
har i UI:t.

```ts
const tools = [
  {
    name: "get_machine_library",
    description:
      "Hämtar hela maskinbiblioteket med mått, kapacitet, portar och " +
      "kategorier. Använd detta innan du föreslår maskiner. Innehåller " +
      "aldrig priser — använd estimate_price för det.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...CATEGORIES] },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "set_flow",
    description:
      "Sätter ett eller flera av de fem flödesvalen och räknar om layouten. " +
      "Returnerar ny layout med diagnostik.",
    input_schema: {
      type: "object",
      properties: {
        infeedFrom:            { type: "string", enum: ["straight","right","left"] },
        controlDeskSide:       { type: "string", enum: ["right","left"] },
        stickerMagazineSide:   { type: "string", enum: ["right","left"] },
        truckPickupSide:       { type: "string", enum: ["right","left"] },
        finalConveyorLengthMm: { type: "integer", minimum: 1000, maximum: 40000 },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_variant",
    description:
      "Skapar ett namngivet alternativ till nuvarande konfiguration utan att " +
      "ändra kundens aktiva layout. Använd detta för optimeringsförslag så " +
      "att kunden kan förhandsgranska och själv välja att applicera.",
    input_schema: { /* ... */ },
    strict: true,
  },
  // add_machine, remove_machine, reorder_line, set_parameter,
  // run_layout, validate_layout, estimate_price, search_documentation
];
```

`strict: true` + `additionalProperties: false` + `enum` på alla
uppräkningsbara fält. Enums respekteras betydligt mer tillförlitligt än
prosainstruktioner.

### 11.3 Fyra AI-lägen i produkten

**Läge 1 — Intag ("Beskriv med egna ord").**
Kunden skriver fritext: *"Vi har en råsorteringslinje, paketen kommer in
rakt, vi vill ha truckströläggare och trucken kommer från vänster. Hallen är
50 × 14 m."* → Claude fyller `Configuration` via **structured outputs**
(Zod-schema, `client.messages.parse`) och ställer följdfrågor på det som
saknas.

**Läge 2 — Förklaring ("Varför?").**
Varje diagnostik har en Varför-knapp. Claude får diagnostiken, maskinernas
data och layoutresultatet och förklarar på svenska, i branschtermer, vad
problemet är och vad konsekvensen blir i drift.

**Läge 3 — Optimering ("Optimera min layout").**
Claude får målfunktion (kortast linje / lägst pris / högst kapacitet /
minst golvyta — kunden väljer), anropar `propose_variant` 1–3 gånger och
presenterar varje variant som ett kort. Applicering är alltid kundens klick.

**Läge 4 — Offerttext.**
Genererar utkast till leveransomfattning, tekniska förutsättningar,
antaganden och avgränsningar. **Alltid markerat som utkast, alltid granskat
av säljare innan det går ut.**

### 11.4 Systemprompt-arkitektur och cachning

Prefixet är stort och stabilt: roll, domänordlista, hela regelverket,
maskinbiblioteket i komprimerad form, UI-kontext. Det ska cachas.

```
system: [
  { type: "text", text: ROLE_AND_DOMAIN },          //  ~3k tokens
  { type: "text", text: RULE_BOOK },                //  ~4k tokens
  { type: "text", text: MACHINE_LIBRARY_DIGEST,     // ~12k tokens
    cache_control: { type: "ephemeral" } },         //  ← breakpoint
],
messages: [ ...history, { role: "user", content: userMessage } ]
```

Ordningen är `tools → system → messages`. Allt volatilt (aktuell
konfiguration, tidsstämplar, sessions-id) placeras **efter** sista
cache-brytpunkten, i meddelandena — annars invalideras cachen vid varje
anrop och kostnaden tiodubblas. Verifiera med
`usage.cache_read_input_tokens`; är den noll vid upprepade anrop finns en
tyst invalidator någonstans.

### 11.5 Modellval och parametrar

```ts
const stream = await client.messages.stream({
  model: "claude-opus-5",
  max_tokens: 64000,
  thinking: { type: "adaptive", display: "summarized" },
  output_config: { effort: "high" },
  system,
  tools,
  messages,
});
```

- **`claude-opus-5`** som standard. Layoutresonemang med
  bikonditionella regler ("om truckströläggare valts, då…") är precis den
  sorts uppgift där resonemangsdjupet syns.
- **`thinking: { type: "adaptive" }`** — modellen avgör själv hur djupt den
  behöver tänka. `budget_tokens` är borttaget på den här modellen och ger 400.
- **`display: "summarized"`** — annars är default `"omitted"` och användaren
  ser en lång tyst paus. En resonerande sammanfattning i AI-panelen
  (*"Kontrollerar truckgatans bredd mot pulpetens placering…"*) gör väntan
  begriplig.
- **`effort`** — `high` för optimeringsläget, `low` eller `medium` för
  intagsläget och enkla förklaringar. Mät innan ni höjer; `xhigh`/`max`
  betalar sig bara på svåra problem.
- **Streaming alltid.** Långa svar utan streaming riskerar HTTP-timeout, och
  UX:en blir sämre.

### 11.6 Structured outputs för intag

```ts
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const IntakeSchema = z.object({
  flow: z.object({
    infeedFrom: z.enum(["straight", "right", "left"]).nullable(),
    controlDeskSide: z.enum(["right", "left"]).nullable(),
    stickerMagazineSide: z.enum(["right", "left"]).nullable(),
    truckPickupSide: z.enum(["right", "left"]).nullable(),
    finalConveyorLengthMm: z.number().int().nullable(),
  }),
  suggestedMachineIds: z.array(z.string()),
  hall: z.object({
    lengthMm: z.number().int().nullable(),
    widthMm: z.number().int().nullable(),
    clearHeightMm: z.number().int().nullable(),
  }),
  missingInformation: z.array(z.string()),   // frågor att ställa kunden
  confidence: z.enum(["low", "medium", "high"]),
});

const response = await client.messages.parse({
  model: "claude-opus-5",
  max_tokens: 16000,
  messages: [{ role: "user", content: customerDescription }],
  output_config: { format: zodOutputFormat(IntakeSchema) },
});

// parsed_output är null om parsning misslyckades — vakta alltid
if (!response.parsed_output) { /* fall tillbaka på formuläret */ }
```

`nullable()` överallt är avsiktligt: modellen ska kunna säga "det här sa
kunden inget om" i stället för att gissa. Gissningar i ett offertunderlag är
värre än luckor.

### 11.7 Skyddsräcken

| Risk | Åtgärd |
|---|---|
| **Prompt injection** via kundens fritext | Verktygen är den enda vägen till systemet. Inget verktyg kan läsa prislistor råa, skriva till DB utanför sessionens konfiguration, eller nå andra kunders data. Sessionen har en fast `configId`. |
| **Hallucinerade maskiner** | `add_machine` validerar `machineId` mot biblioteket och returnerar fel vid okänt id. Modellen ser felet och korrigerar. |
| **Hallucinerade priser** | Priser finns aldrig i prompten. `estimate_price` returnerar serverberäknat belopp. Systemprompten förbjuder uttryckligen att nämna belopp som inte kommer från verktyget. |
| **Bindande utfästelser** | All AI-genererad text i offertunderlaget märks som utkast och passerar säljare. Disclaimers i PDF-mallen. |
| **Kostnadsrusning** | Rate limit per session och per IP, takbelopp per dag, `max_tokens`-tak, och en hård gräns på antal verktygsanrop per tur (t.ex. 20). |
| **Nedtid hos API:t** | Verktyget fungerar fullt ut utan AI. AI-panelen degraderar till "tillfälligt otillgänglig". Ingen kärnfunktion får bero på modellen. |

Den sista punkten är arkitektoniskt viktig: **AI:n är ett lager ovanpå en
komplett produkt, inte produktens fundament.**

---

## 12. Prissättning

### 12.1 Tre synlighetsnivåer

| Roll | Ser |
|---|---|
| Anonym besökare | Ingen prisuppgift, eller prisintervall per kategori ("från ca X kkr") |
| Inloggad kund | Indikativt totalpris ±20 %, uppdelat per maskin |
| INKAB säljare | Listpris, inköpspris, marginal, rabattverktyg, skarpt pris |

Detta är både ett affärs- och ett säkerhetskrav: **prislistan får aldrig
skickas till webbläsaren i sin helhet.** Allt prisarbete sker i
serverfunktioner; klienten får bara det aggregat som rollen tillåter.

### 12.2 Prismodell

```
Totalpris = Σ (basPris_maskin × antal)
          + Σ optionsprisdeltan
          + parametriserade poster (t.ex. kedjetransportör: pris/löpmeter)
          + montagepåslag (andel av maskinvärde, per kategori)
          + el- och styrpåslag
          + frakt (schablon per zon)
          − rabatt (endast säljarroll)
```

Alla faktorer i en versionerad `PriceBook` med giltighetsdatum, så att en
sparad konfiguration kan visa "priset beräknat 2026-09-08, giltigt t.o.m.
2026-12-31" och räknas om mot aktuell prisbok på begäran.

---

## 13. CAD-pipeline och STEP-hantering

### 13.1 Två representationer per maskin

| | Webbmodell | Leveransmodell |
|---|---|---|
| Format | `.glb` (glTF 2.0, Draco) | `.step` (AP214/AP242) |
| Syfte | Rendering i browsern | Kundens layoutarbete i eget CAD |
| Detaljnivå | Förenklad, ~50–300 kB | Envelope + monteringspunkter |
| Åtkomst | Publik | Bakom inloggning + loggning |

**Ladda aldrig råa STEP-filer i browsern som standardflöde.** Tessellering
av en STEP i WASM tar sekunder till minuter och kan ge tiotals megabyte
geometri. `occt-import-js` (OpenCascade kompilerat till WASM) är ändå värt
att ha för ett sidoflöde: *kunden laddar upp sin egen befintliga utrustning
för att se den i layouten*. Kör det i en Web Worker så att UI:t inte fryser.

### 13.2 Konverteringspipeline (offline, i admin)

```
  Konstruktörens CAD  ──►  STEP (AP242)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        förenkling     tessellering    metadata
        (envelope,     (OCCT/CLI)      (bounding box,
         ta bort                        portkandidater)
         skruvar)          │
              │            ▼
              │      .glb + Draco
              │            │
              ▼            ▼
        step-fil i    glb i CDN
        privat bucket
```

Konverteringen kan köras som ett CLI-steg i admin-uppladdningen
(t.ex. Python + `cadquery`/OCC, eller en betald tjänst som CAD Exchanger om
volymen är låg och tiden dyr). Det manuella momentet är förenklingen — en
komplett maskinmodell med varje bult är oanvändbar både i browsern och i
kundens layout.

### 13.3 Leverans av STEP till kund

Tre alternativ, i stigande skyddsnivå:

1. **Direkt nedladdning efter inloggning.** Enklast, mest generöst.
2. **Envelope publikt, detaljerad efter förfrågan.** Kunden får en
   förenklad volymmodell med anslutningspunkter direkt; den riktiga modellen
   kommer med offerten. **Detta rekommenderar jag** — det räcker för
   kundens layoutarbete och skyddar konstruktionen.
3. **Endast efter signerat sekretessavtal.** Om modellerna innehåller
   verklig konstruktions-IP.

Oavsett val: signerade, tidsbegränsade URL:er, nedladdningslogg per
användare och fil, och metadatastämpling i STEP-headern med kund + datum +
konfigurations-id (spårbarhet vid läckage).

---

## 14. Offertunderlag och PDF

### 14.1 Innehåll

| Sida | Innehåll |
|---|---|
| 1 | Försättsblad: kund, projekt, offertnummer, datum, giltighetstid, kontaktperson |
| 2 | Sammanfattning: vad anläggningen gör, kapacitet, totalmått, prisindikation |
| 3 | **Layoutritning, topvy, måttsatt** (A3 liggande), positionsnummer |
| 4 | 3D-vy (ISO) + detaljvyer inmatning / utlastning |
| 5 | Maskinlista: pos, artikel, benämning, antal, valda optioner, radpris |
| 6 | Tekniska förutsättningar: el (kW, matning), tryckluft, fundament/gropar, fri takhöjd, golvbelastning |
| 7 | Flöde och kapacitet: paket/h, dimensionsintervall, flaskhals |
| 8 | Antaganden och avgränsningar (AI-utkast, säljargranskat) |
| 9 | Leveransomfattning / ej ingående |
| 10 | Villkor, leveranstid, kontakt |

### 14.2 Teknik

**Rekommendation: HTML-mall + Playwright/Chromium på servern.** Motiv:

- Samma designsystem och typografi som appen, ingen parallell mall att underhålla
- CSS `@page`, sidbrytningar, sidhuvud/sidfot fungerar
- Vektorgrafik för planvyn: rendera topvyn som **SVG direkt ur
  layoutresultatet**, inte som skärmdump — måttsättning och text blir skarpa
  och sökbara i PDF:en
- 3D-vyerna renderas headless med samma three.js-scen och kameraförval

Alternativ: `@react-pdf/renderer` (enklare drift, sämre kontroll över
måttsatt ritning). Undvik klientgenererad PDF — den kan förfalskas och
saknar serverns prisdata.

### 14.3 Fler exportformat

- **DXF/DWG av planvyn** — konstruktörer vill ha det, och det är en enkel
  export ur samma geometri. Stark differentiator.
- **Excel av maskinlistan** för kundens egen kalkyl.
- **Delningslänk** till skrivskyddad 3D-vy, som fungerar utan inloggning.
  Det är den som faktiskt sprids internt hos kunden och drar in fler
  intressenter i affären.

---

## 15. Inloggning och roller

| Roll | Rättigheter |
|---|---|
| `guest` | Konfigurera, se layout, se prisintervall, ingen sparning (endast localStorage) |
| `customer` | Allt ovan + spara projekt, indikativa priser, PDF, STEP-nedladdning, dela länk |
| `sales` | Allt ovan + alla kunders konfigurationer, inköpspris/marginal, rabatt, skarp offert, e-postutskick |
| `engineer` | Underhålla maskinbibliotek, regler och prisbok |
| `admin` | Användare, roller, loggar |

**Rekommendation:** Auth.js (NextAuth) v5.

- Kund: magisk länk via e-post (ingen lösenordshantering) eller
  Google/Microsoft-inloggning
- Internt: Microsoft Entra ID mot INKAB:s tenant, roller ur gruppmedlemskap

**Registreringsströskeln är en produktdesignfråga, inte en teknisk.** Mitt
råd: låt kunden bygga hela layouten anonymt och kräv inloggning först vid
**PDF, STEP eller sparning**. Då har hen redan investerat 15 minuter och
konverterar. Kräv inloggning på förhand och ni tappar merparten av
besökarna.

---

## 16. Teknikval

| Lager | Val | Motiv | Alternativ |
|---|---|---|---|
| Ramverk | **Next.js 15 (App Router) + TypeScript** | SSR för SEO på landningssidan, Route Handlers för AI-streaming, samma språk klient/server så layoutmotorn delas | Remix, SvelteKit |
| 3D | **three.js + react-three-fiber + drei** | Störst ekosystem, deklarativt i React, `<Html>` för 3D-förankrade etiketter | Babylon.js (tyngre), ren three.js (mer boilerplate) |
| 2D-planvy | Samma scen, ortografisk kamera | Ingen andra renderare att synka | separat SVG/Canvas-vy |
| State | **Zustand + Immer**, undo/redo-middleware | Litet, snabbt, enkel historik | Redux Toolkit, Valtio |
| UI | **Tailwind + shadcn/ui + Radix** | Snabbt, tillgängligt, lätt att styla mot ert varumärke | MUI |
| Validering | **Zod** | Delas mellan formulär, API och Claude structured outputs | Valibot |
| AI | **`@anthropic-ai/sdk`, `claude-opus-5`** | Verktygsanvändning, structured outputs, streaming, prompt caching | — |
| DB | **PostgreSQL + Prisma** | Relationellt passar konfiguration/version/offert; JSONB för konfig-blob | Drizzle (lättare), SQLite för MVP |
| Filer | **S3-kompatibel (Cloudflare R2 / AWS S3)** | Signerade URL:er, billig lagring av STEP/GLB/PDF | Vercel Blob |
| PDF | **Playwright/Chromium + HTML-mall + SVG-ritning** | Delad design, vektorritning | @react-pdf/renderer |
| STEP-läsning (valfritt) | **occt-import-js** i Web Worker | Kundens egna filer | serverkonvertering |
| E-post | Resend / Postmark | Magiska länkar, offertutskick | SendGrid |
| Hosting | Vercel (app) + Neon/Supabase (DB) + R2 (filer) | Låg driftbörda | Egen server / Docker hos svensk leverantör om datahemvist krävs |
| Analys | Plausible eller PostHog | GDPR-vänligt, funnel-analys | GA4 |
| Fel | Sentry | — | — |

### Datahemvist

Om INKAB eller era kunder kräver att data stannar i EU: Vercel och Neon har
EU-regioner, R2 kan låsas till EU. För Claude API — kontrollera aktuella
villkor kring datahantering och teckna DPA. Alternativt kan appen driftas
helt i EU och endast AI-anropen gå ut, med kundtext minimerad i prompten.

---

## 17. Datamodell

```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String?
  company        String?
  role           Role     @default(CUSTOMER)
  configurations Configuration[]
  quotes         Quote[]
  downloads      Download[]
  createdAt      DateTime @default(now())
}

enum Role { GUEST CUSTOMER SALES ENGINEER ADMIN }

model Machine {
  id           String   @id
  sku          String   @unique
  category     String
  status       String   @default("active")
  data         Json     // hela Machine-schemat
  priceBookId  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model PriceBook {
  id         String   @id @default(cuid())
  name       String
  validFrom  DateTime
  validUntil DateTime
  entries    Json     // maskin-id → pris, optioner, påslag
  active     Boolean  @default(false)
}

model Configuration {
  id         String   @id @default(cuid())
  publicId   String   @unique          // kort id för delningslänk
  name       String
  ownerId    String?
  owner      User?    @relation(fields: [ownerId], references: [id])
  data       Json                       // Configuration-schemat
  layoutHash String                     // för cache av renderingar
  versions   ConfigurationVersion[]
  quotes     Quote[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model ConfigurationVersion {
  id              String   @id @default(cuid())
  configurationId String
  version         Int
  data            Json
  label           String?                // "Variant B – kortad linje"
  createdAt       DateTime @default(now())
}

model Quote {
  id              String   @id @default(cuid())
  quoteNumber     String   @unique
  configurationId String
  customerId      String?
  status          String   // draft | sent | accepted | lost
  priceBookId     String
  totals          Json
  pdfUrl          String?
  aiDraftText     String?  @db.Text       // AI-utkast, före granskning
  reviewedById    String?
  sentAt          DateTime?
  createdAt       DateTime @default(now())
}

model AiSession {
  id              String   @id @default(cuid())
  configurationId String
  userId          String?
  messages        Json                    // transkript
  toolCalls       Json
  inputTokens     Int
  outputTokens    Int
  cacheReadTokens Int
  costSek         Decimal  @db.Decimal(10,4)
  createdAt       DateTime @default(now())
}

model Download {
  id        String   @id @default(cuid())
  userId    String
  fileType  String   // step | pdf | dxf
  machineId String?
  configId  String?
  ip        String?
  createdAt DateTime @default(now())
}

model Lead {
  id              String   @id @default(cuid())
  configurationId String
  name            String
  email           String
  phone           String?
  company         String?
  message         String?  @db.Text
  status          String   @default("new")
  createdAt       DateTime @default(now())
}
```

`AiSession` med tokenräkning och kostnad per session är inte överarbete —
det är det ni behöver för att kunna svara på "vad kostar AI:n oss per lead?"
efter tre månader.

---

## 18. API-ytor

```
POST   /api/configurations                  skapa
GET    /api/configurations/:id              hämta (ägare eller publicId)
PATCH  /api/configurations/:id              uppdatera
POST   /api/configurations/:id/versions     spara variant
POST   /api/configurations/:id/duplicate

POST   /api/layout/solve                    server-sanning för layout
POST   /api/layout/validate

GET    /api/machines                        publikt bibliotek (utan priser)
GET    /api/machines/:id
POST   /api/machines                        engineer+
POST   /api/machines/:id/assets             STEP-uppladdning → GLB-konvertering

POST   /api/price/estimate                  serverberäknat, rollfiltrerat

POST   /api/ai/chat                         SSE-ström, verktygsloop
POST   /api/ai/intake                       fritext → Configuration (structured output)
POST   /api/ai/explain                      diagnostik → förklaring

POST   /api/export/pdf                      → signerad URL
POST   /api/export/dxf
GET    /api/export/step/:machineId          auth + logg + signerad URL

POST   /api/leads                           offertförfrågan
POST   /api/quotes                          sales+
```

### AI-strömmen

`/api/ai/chat` är en Route Handler som streamar. Klienten får tre sorters
händelser:

- `thinking` — sammanfattad resonemangstext till AI-panelen
- `tool` — vilket verktyg som körs, så UI:t kan visa "Kontrollerar
  truckgatans bredd…" och **animera ändringen i CAD-vyn i realtid**
- `text` — svaret

Att visa verktygsanropen i CAD-vyn medan de sker är den enskilt starkaste
UX-detaljen i hela AI-integrationen: kunden ser maskinen flytta sig medan
Claude förklarar varför.

---

## 19. Säkerhet, IP och GDPR

| Område | Åtgärd |
|---|---|
| **Prislista** | Aldrig i klienten. Serverberäkning, rollfiltrerat svar. |
| **STEP-filer** | Privat bucket, signerade URL:er med kort TTL, nedladdningslogg, metadatastämpling, envelope-modeller publikt |
| **Prompt injection** | Verktygsskal, sessionsbunden `configId`, inga fritt formulerade DB-frågor, kundtext behandlas som data |
| **Rate limiting** | Per IP och per session på AI-endpoints, PDF-generering och STEP-nedladdning |
| **Persondata** | Endast namn, e-post, företag, telefon i leads. Ingen persondata i AI-prompter utöver projektbeskrivningen. |
| **GDPR** | Personuppgiftspolicy, DPA med Anthropic och övriga underbiträden, radering på begäran, retentionspolicy på AI-transkript (t.ex. 90 dagar) |
| **Cookies** | Endast nödvändiga + samtycke för analys |
| **Loggning** | Alla prisvisningar, STEP-nedladdningar och offertgenereringar loggas med användare och tidpunkt |
| **Ansvarsfriskrivning** | Synlig i UI och i PDF: prisindikation, ej bindande, förbehåll för konstruktionsändringar |

---

## 20. Prestanda

| Krav | Mål | Hur |
|---|---|---|
| Första meningsfulla rendering | < 1,5 s | SSR av skalet, 3D laddas lat |
| Layoutomräkning vid ändring | < 16 ms | Ren TS-funktion, ingen nätverksrunda |
| Scenladdning, 10 maskiner | < 2 s | Draco-komprimerad GLB, parallell hämtning, LOD |
| Bildfrekvens under orbit | 60 fps | Instancing på repeterad geometri (kedjelänkar, rullar), frustum culling, ingen skuggmappning i 2D-läget |
| PDF-generering | < 8 s | Cache på `layoutHash`, förrenderade vyer |
| AI-första-token | < 2 s | Streaming + prompt cache |

**Detaljnivå per maskin: håll GLB under 300 kB.** En ström-läggare med varje
kedjelänk modellerad är vacker och obrukbar. Använd två LOD-nivåer: en
förenklad för översikt, en detaljerad som laddas när kameran är nära.

---

## 21. Kostnadsbild

### 21.1 Claude API

Priser för `claude-opus-5`: **5 USD per miljon input-tokens, 25 USD per
miljon output-tokens.** Cacheläsningar kostar en bråkdel av vanlig input.

Uppskattning per konfigurationssession (grov, mät i pilot):

| Post | Tokens | Kommentar |
|---|---|---|
| Systemprefix, första anropet | ~19 000 in | Full kostnad en gång |
| Systemprefix, följande anrop | ~19 000 cache-läsning | Kraftigt rabatterat |
| Per tur: konfiguration + fråga | ~2 000 in | Efter cache-brytpunkten |
| Per tur: resonemang + svar + verktygsanrop | ~2 500 ut | |
| Typisk session | 8–15 turer | |

Grovt: **i storleksordningen några kronor per konfigurationssession**, och
ett par ören för ett enkelt "förklara den här varningen". Vid 200 sessioner
i månaden hamnar man i storleksordningen några hundralappar till någon
tusenlapp — försumbart mot värdet av en kvalificerad förfrågan.

**Men:** kostnaden är helt beroende av att prompt-cachningen fungerar.
Utan cache blir samma session 5–10 gånger dyrare. Bygg in
`cache_read_input_tokens`-mätning i `AiSession` från dag ett och larma om
kvoten sjunker.

**Kostnadsdämpare om volymen växer:**
- Enkla rutter (förklara diagnostik, intag) kan köras på en mindre modell —
  mät kvaliteten först
- Sänk `effort` till `medium` eller `low` på rutiner som inte kräver djup
- Takbelopp per session och per dygn

### 21.2 Övrig drift

| Post | Storleksordning per månad |
|---|---|
| Hosting (Vercel Pro eller motsvarande) | låg |
| Databas (Neon/Supabase) | låg |
| Objektlagring + CDN (R2) | låg vid dessa datamängder |
| E-post (Resend) | låg |
| Sentry / analys | låg |

Driftkostnaden är inte projektets fråga. **Utvecklings- och datainsamlings-
insatsen är det.**

---

## 22. Roadmap

### Fas 0 — Underlag (3–4 veckor, mest INKAB:s arbete)

- [ ] Fastställ maskinlistan för pakethantering (10–20 maskiner till start)
- [ ] Samla mått, kapacitet, el/tryckluft, fundament per maskin
- [ ] Definiera portar (in/ut, position, riktning, nivå) per maskin
- [ ] Workshop med konstruktörer: **skriv ner flödesreglerna** — detta är
      det svåraste och viktigaste steget. Tyst kunskap ska bli R-koder.
- [ ] Fastställ prisbok och prispolicy (vad visas för vem)
- [ ] Ta fram/förenkla STEP-modeller, generera GLB
- [ ] Beslut om STEP-leveransnivå (envelope vs detaljerad)

**Gör inte fas 1 innan fas 0 är klar.** Ett verktyg med fem maskiner och
skarpa regler är oändligt mycket bättre än ett med trettio maskiner och
gissade regler.

### Fas 1 — MVP (6–8 veckor)

- [ ] Helskärmsskal: sidebar, CAD-vy, inspektor, statusrad
- [ ] 2D-planvy + enkel 3D
- [ ] Maskinkatalog och linjelista med drag & drop
- [ ] De fem flödesfrågorna med piktogram-UI
- [ ] Deterministisk layoutmotor + de 10 viktigaste reglerna
- [ ] Hallmått-overlay
- [ ] PDF-export (topvy + maskinlista + tekniska förutsättningar)
- [ ] Lead-formulär → e-post till säljare
- [ ] Ingen AI, ingen inloggning, ingen prisvisning

**Målet med MVP är att validera att layoutmotorn ger layouter era
konstruktörer känner igen.** Låt tre konstruktörer testa och räkna hur ofta
de säger "nej, så gör vi aldrig".

### Fas 2 — AI och konto (6–8 veckor)

- [ ] Inloggning (magisk länk + Entra internt), roller
- [ ] Sparade projekt, versioner, delningslänkar
- [ ] Prisberäkning, rollfiltrerad
- [ ] Claude-integration: alla fyra lägena, verktygsskal, streaming
- [ ] Diagnostik förankrad i 3D + "Varför?"
- [ ] STEP-nedladdning med loggning
- [ ] Säljvy: alla konfigurationer, offertgenerering

### Fas 3 — Bredd och polering (löpande)

- [ ] Resten av maskinportföljen
- [ ] Flödesanimation
- [ ] A/B-jämförelse
- [ ] Hallunderlag (uppladdad ritning, georeferering)
- [ ] DXF-export
- [ ] Engelska (+ finska/tyska vid behov)
- [ ] CRM-integration, ERP-priser
- [ ] Mallbibliotek av typiska linjer

### Fas 4 — Avancerat

- [ ] Riktig layoutoptimerare (flera linjer, U-form, pelarhänsyn)
- [ ] Simulering av flöde och buffertar
- [ ] Kollisionskontroll mot inmätt befintlig anläggning (punktmoln)
- [ ] AR-vy på plats i hallen

---

## 23. Mätetal

| Mätetal | Varför | Startmål |
|---|---|---|
| Konfigurationer startade / vecka | Efterfrågan | — |
| **Slutförandegrad** (startad → färdig layout) | UX-kvalitet | > 40 % |
| **Konverteringsgrad** (färdig layout → offertförfrågan) | Affärsvärde | > 25 % |
| Tid från besök till förfrågan | Effektivitet | < 30 min |
| Tid från förfrågan till offert | Huvudmålet | Halverad |
| Andel förfrågningar med komplett underlag | Kvalificering | > 80 % |
| Konstruktionstimmar i förprojekt | Kostnadsbesparing | −50 % |
| Offert → order | Slutmålet | Följ trenden |
| AI-turer per session, kostnad per lead | Kostnadskontroll | Mät från dag ett |
| Andel AI-förslag som appliceras | AI-kvalitet | > 30 % |
| Cache-läsningskvot | Kostnadseffektivitet | > 80 % |

---

## 24. Risker

| Risk | Sannolikhet | Konsekvens | Åtgärd |
|---|---|---|---|
| **Maskindata och regler tar mycket längre tid än väntat** | Hög | Hög | Fas 0 som eget projekt med egen tidplan. Börja med 5 maskiner, inte 30. |
| Konstruktörernas tysta kunskap går inte att formalisera | Medel | Hög | Workshop tidigt. Om reglerna inte går att skriva ner för fem maskiner är projektet inte moget. |
| Verkliga anläggningar är alltid specialare — verktyget täcker bara standardfall | Hög | Medel | Positionera som förstudie. Ha alltid "Prata med en ingenjör"-knapp synlig. |
| STEP-filer läcker till konkurrent | Medel | Medel | Envelope-modeller publikt, detaljerade efter kontakt, stämpling och logg |
| AI ger tekniskt felaktigt råd som kunden litar på | Medel | Hög | Verktygsskal, deterministisk validering, disclaimers, säljargranskning av all utgående text |
| Prisindikation uppfattas som bindande | Medel | Hög | Tydlig märkning i UI och PDF, juridisk granskning av villkorstexten |
| Prestanda i browser med många tunga modeller | Medel | Medel | LOD, Draco, instancing, budget på 300 kB/maskin |
| Låg användning — kunderna ringer hellre | Medel | Medel | Låg tröskel (ingen inloggning för att bygga), mallar, marknadsför på mässa och i säljmöten |
| Beroende av extern AI-leverantör | Låg | Låg | AI:n är ett lager, inte fundamentet. Verktyget fungerar utan. |

---

## 25. Öppna frågor till INKAB

Dessa behöver besvaras innan fas 0 kan starta på allvar. De är sorterade
efter hur mycket de påverkar arkitekturen.

**Produkt och domän**

1. **Vilka maskiner ska ingå?** Namn, artikelnummer, kategori. Min lista i
   kapitel 7 är branschgenerisk — ersätt den.
2. Finns mått och kapacitetsdata samlat, eller ligger det i ritningar?
3. Är linjen alltid en **kedja**, eller finns förgreningar (två utmatningar,
   parallella linjer)? Detta avgör om layoutmotorn behöver bli en grafmotor.
4. Vilka riktningsändringar är tillåtna och i vilka maskiner?
5. Vilka regler är absoluta (får aldrig brytas) och vilka är tumregler?
6. Vad är typisk truckgatebredd och svängradie i era anläggningar?
7. Hur bestäms pulpetens placering i praktiken idag — sikt, kabeldragning,
   närhet till en viss station?
8. Finns det standardpaketformat, eller varierar det per kund?

**Affär**

9. Får prisindikation visas publikt, eller endast efter inloggning?
10. Ska det vara listpris, intervall, eller "från"-pris?
11. Vem äger leaden när den kommer in — finns CRM att integrera mot?
12. Vad är rimlig prisnoggrannhet att utlova (±10 %? ±25 %?)

**CAD och IP**

13. Vilket CAD-system används, och finns STEP-export uppsatt?
14. Hur känsliga är modellerna — envelope eller detaljerat till kund?
15. Finns renderingar/foton per maskin, eller ska de tas fram?

**Organisation**

16. Vem äger maskinbiblioteket långsiktigt (uppdaterar priser och data)?
17. Vem granskar AI-genererad offerttext innan den går ut?
18. Finns intern utvecklingsresurs, eller ska allt köpas in?
19. Krav på datahemvist i EU/Sverige?
20. Målspråk vid lansering — bara svenska, eller svenska + engelska?

---

## 26. Föreslagen repo-struktur

Monorepo, så att layoutmotorn och typerna delas mellan app, PDF-generator
och admin utan kopiering.

```
inkab/
├── README.md                        ← detta dokument
├── package.json                     (pnpm workspaces)
├── turbo.json
│
├── apps/
│   ├── web/                         Next.js — publik konfigurator
│   │   ├── app/
│   │   │   ├── (marketing)/         landningssida, SEO
│   │   │   ├── konfigurator/        helskärmsappen
│   │   │   ├── projekt/[id]/        sparade konfigurationer
│   │   │   ├── admin/               maskinbibliotek, prisbok
│   │   │   └── api/                 route handlers (kap. 18)
│   │   ├── components/
│   │   │   ├── shell/               topbar, sidebar, inspektor, statusrad
│   │   │   ├── cad/                 canvas, kamera, gizmos, mätverktyg, zoner
│   │   │   ├── catalog/             maskinkort, sök, drag & drop
│   │   │   ├── flow/                de fem frågorna, piktogram
│   │   │   ├── ai/                  chattpanel, förslagskort, streaming
│   │   │   └── quote/               summering, export, lead-formulär
│   │   └── lib/
│   └── worker/                      STEP→GLB-konvertering, PDF-jobb
│
├── packages/
│   ├── layout-engine/               ⭐ deterministisk solver + regelmotor
│   │   ├── src/solve.ts
│   │   ├── src/rules/               en fil per regelgrupp
│   │   └── src/__tests__/           snapshot-tester per typlayout
│   ├── machine-schema/              Zod-scheman + typer (delas överallt)
│   ├── pricing/                     prisberäkning (endast server)
│   ├── ai/                          verktygsdefinitioner, prompter, klient
│   ├── pdf/                         HTML-mallar, SVG-ritningsgenerator
│   └── ui/                          designsystem
│
├── data/
│   ├── machines/                    JSON per maskin (versionerat i git)
│   ├── rules/                       regeldefinitioner
│   └── pricebooks/                  ej i git — hämtas från DB
│
└── docs/
    ├── layoutregler.md              regelverket i klartext för konstruktörer
    ├── maskinbibliotek.md           hur man lägger till en maskin
    └── ai-prompts.md                versionerade systemprompter
```

**Att maskindata ligger som JSON i git** är ett medvetet val för fas 1:
versionshantering, granskning via pull request, ingen admin-UI att bygga
först. Flytta till databas när konstruktörerna ska redigera själva.

---

## 27. Källor

Domän och bransch:

- [INKAB – ingenjörsfirma Nybergs konstruktion](https://www.inkab.nu/) *(kunde inte hämtas — blockerad av sessionens egress-policy)*
- [SLA: Årsredovisningen klar – så gick det för Inkab](https://www.sla.se/2026/03/12/arsredovisningen-klar-sa-gick-det-for-inkab-ingenjorsfirma-nybergs-konstruktion-ab-ddb0e)
- [Almab Storvik – Ströläggning](http://www.almab.se/Strolaggning)
- [Almab Storvik – Paketläggare med sekundärhiss](https://almab.se/Paketlaggare-med-sekundarhiss)
- [CGV – Ströläggare för råsortering](https://cgv.se/strolaggare)
- [Renholmen – Ströläggare](https://renholmen.se/en/produkter/stickerk-stacker-2/)
- [Framtec – Ströautomat/ströläggare](https://www.framtec.se/en/products/stick-handling/stick-robot-stacker/)
- [Roséns – Råsortering i sågverk](https://www.rosens.se/en/rasortering/sagverk/)
- [LW Bålsta – Paketläggare](https://lwbalsta.se/produkter/hanteringsutrustning/paketlaggare/)
- [Bruks Siwertell – Kedjetransportörer](https://bruks-siwertell.com/sv/conveying/chain-conveyors)
- [Skogen – ordlista sågverk](https://www.skogen.se/glossary/sagverk/)

Teknik:

- [occt-import-js (OpenCascade i WASM)](https://github.com/kovacsv/occt-import-js)
- [occt-step-viewer-web](https://github.com/Roadinforest/occt-step-viewer-web)
- [svelte-step – STEP-viewer](https://github.com/ubemacapuno/svelte-step)
- [D-LAB: Mastering 3D Configurators with React Three Fiber](https://d-lab.codes/blog/mastering-3d-configurators-with-react-three-fiber)
- [Wawa Sensei: 3D product configurator med three.js](https://wawasensei.dev/tuto/how-to-use-three-js-to-create-a-3D-product-configurator)
- [Developers Digest: Tool Use in the Claude API – production patterns](https://www.developersdigest.tech/blog/tool-use-claude-api-production-patterns)

Marknad och forskning:

- [Configurix – industrial equipment configurator](https://www.configurix.com/industrial-equipment-configurator-for-manufacturers)
- [CanvasLogic – CPQ för tillverkning](https://canvaslogic.com/best-cpq-software-for-manufacturing-industry/)
- [Infor Visual CPQ](https://www.infor.com/solutions/service-sales/configure-price-quote)
- [LayoutCopilot: An LLM-powered Multi-agent Framework for Interactive Analog Layout Design](https://arxiv.org/pdf/2406.18873)
- [SceneGenAgent: Precise Industrial Scene Generation with Coding Agent](https://arxiv.org/pdf/2410.21909)
- [Holodeck: Language Guided Generation of 3D Environments](https://arxiv.org/pdf/2312.09067)

---

## Nästa steg

1. Gå igenom [öppna frågor](#25-öppna-frågor-till-inkab) — särskilt fråga 1, 3 och 5.
2. Boka workshopen i fas 0 med konstruktörerna. **Reglerna är projektet.**
3. Bekräfta teknikvalen i kapitel 16.
4. Bestäm omfattningen på MVP: vilka fem maskiner?

Säg till när frågorna är besvarade så tar vi nästa steg — antingen en
klickbar UI-prototyp av helskärmsvyn, eller layoutmotorn med era verkliga
maskindata.
