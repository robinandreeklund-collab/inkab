# Från 80 MB STEP till en anläggning i webbläsaren

Analys av den föreslagna CAD-pipelinen, och vad jag skulle ändra.

> Kort version: grundplanen är rätt. Det mesta jag har att säga handlar om att
> göra **mindre** än vad som föreslås, i en annan ordning.

---

## Vad som är rätt, och varför

**Aldrig STEP i webbläsaren.** Det här är den enda punkten som är
avgörande. En 80 MB STEP är B-rep — matematiska ytor som måste tesselleras
till trianglar innan något kan ritas. Att göra det i en flik betyder tiotals
sekunder i en WASM-tråd och hundratals megabyte trianglar i minnet, per
maskin. Offline, en gång per maskintyp, är det enda som fungerar.

**Katalogkortet är produkten, inte modellen.** Skissen i förslaget —
`footprint`, `clearance`, `ports` — är exakt vad konfiguratorn redan äter.
Layoutmotorn i `src/lib/solver.ts` behöver aldrig se en enda triangel. Det
betyder att **3D-modellerna inte blockerar något**: verktyget fungerar fullt
ut med bara fotavtryck och portar, vilket det gör idag.

**Portarna är det som gör det till en anläggning.** Helt enigt. Utan dem är
3D en hög med lådor. Det är också redan byggt: solvern kopplar utport mot
inport, roterar och speglar maskinen så att de möts, och regelverket fångar
höjdskillnader och breddintervall.

**Parametriska transportörer mellan portarna.** Rätt. En kedjetransportör är
en sträcka, inte en modell — den ska genereras, inte laddas. Vår
`parametricLength` gör redan detta i geometrin; 3D behöver bara samma sak i
mesh.

**2D som arbetsyta, 3D som belöning.** Rätt prioritering. Kunden möblerar en
hall, den navigerar inte i CAD.

---

## Fem saker jag skulle ändra

### 1. Inför inte en andra renderare

Förslaget nämner PixiJS eller Konva för 2D. Jag skulle avstå.

2D-vyn är redan byggd i SVG, driven av samma solverutdata som allt annat.
Den hanterar drag, ritverktyg, zoner, måttsättning och diagnostik i ett
koordinatsystem. En canvas-baserad editor betyder två renderingsstackar, två
träffdetekteringsmodeller och två uppsättningar buggar.

Det tyngsta argumentet är dock ett annat: **2D-vyn matar offerten.** SVG är
vektor, vilket ger skarpa måttsatta ritningar i PDF:en. En canvas-baserad
editor hade behövt en separat SVG-väg för utskriften ändå — alltså samma
arbete plus en renderare till.

SVG börjar svaja någonstans kring 5 000–10 000 noder. En linje med 40
maskiner, zoner, portar och måttlinjer ligger under 1 000. Gränsen nås först
med ett inläst hallunderlag i DXF med tiotusentals segment — och då är svaret
att lägga *underlaget* i ett canvas-lager bakom SVG:n, inte att flytta allt.

**Rekommendation:** SVG för 2D, three.js för 3D. Byt först när mätning säger
att det behövs.

### 2. Hoppa över proxy-modellen tills vidare

Förslaget vill ha två GLB per maskin: `proxy` under 200 KB och `hero` på
2–8 MB.

2D-vyn behöver ingen mesh alls — den ritar fotavtryck ur katalogkortet. Och
under drag i 3D räcker det att inte rendera om i full takt. Så proxyns enda
verkliga nytta är översiktsvyn med många maskiner samtidigt.

Där löser instansiering problemet bättre: en anläggning har 10–40 maskiner men
bara 10–15 unika SKU. Laddar man varje SKU en gång och instansierar är det
antalet unika modeller som räknas, inte antalet på golvet.

Två filer per maskin är däremot **värt det om proxyn genereras automatiskt**
— decimering till några hundra trianglar, noll handpåläggning. Kostar den en
timme per maskin i en CAD-operatörs tid är den inte värd det.

**Rekommendation:** en hero-GLB per SKU, budget **1–2 MB, inte 2–8**. Lägg
till proxy senare, och bara om den kan skriptas.

### 3. Tessellingstoleransen är den stora spaken, inte komprimeringen

Det här är den praktiskt viktigaste punkten i hela analysen.

En STEP tessellerad med default-tolerans ger ofta 200 000+ trianglar per
maskin — kurvor upplösta till tiondels millimeter. På en anläggningsritning
där maskinen är 8 cm på skärmen är det bortkastat. Samma kropp vid 5 mm
kordatolerans är visuellt identisk och 20–50 gånger mindre.

Att komprimera bort överskottet är att lösa fel problem. Ställ toleransen
rätt först, komprimera sedan.

Näst största spaken: **ta bort det som inte syns** innan tessellering.
Skruvar, lager, invändiga mekanismer, kablage. Det är där 80 MB kommer
ifrån. Går att regelstyra i CAD-systemet — dölj allt vars omslutande låda är
mindre än säg 50 mm.

När det är gjort: **meshopt framför Draco.** Liknande storlek efter gzip, men
väsentligt snabbare avkodning, och avkodningstiden är vad kunden känner när
15 SKU strömmas in. KTX2 för texturer — men maskinmodeller med plana färger
har knappt några texturer, så prioritera inte det.

### 4. Bestäm origo en gång, och välj inmatningsporten

Förslaget säger "origo i golvcentrum **eller** i inmatningsporten". Det där
"eller" kostar pengar om det besvaras två gånger.

Välj **inmatningsporten, i golvnivå, X i flödesriktningen**. Det är vad
solvern redan antar, och det gör portkoordinaterna i katalogkortet identiska
med modellens. Golvcentrum tvingar fram en offset per maskin som någon
kommer att sätta fel.

Enheter: glTF är meter enligt konvention, vår motor är **heltal millimeter**.
Konvertera på ett ställe, vid inläsning. Skriv ner det innan någon gör det
två gånger.

### 5. Namnge variantnoder efter option-id

Förslaget vill dela modellen i noder för varianter — lucka, magasin,
robotcell. Bra. Gör konventionen explicit: **nodens namn är samma sträng som
optionens id i katalogkortet.**

Då behöver visaren ingen kod per maskin. Den tänder och släcker noder efter
vilka optioner kunden kryssat i. Vi har redan `options` och `parameters` per
maskin i admin-vyn; det här kopplar ihop dem med geometrin utan ett enda
specialfall.

---

## Två saker som saknas i planen

### GLB hör inte hemma i biblioteksdokumentet

Maskinbiblioteket lagras idag som ett JSON-dokument, i Postgres eller
versionshanterat i repot. Bilder ligger som base64 i det dokumentet, vilket är
rimligt för foton på några hundra kilobyte.

För GLB på 1–2 MB × 17 maskiner är det fel. De ska ligga i objektlagring
(Cloudflare R2 eller S3) och katalogkortet ska bära en URL. Det är en
liten ändring nu och en jobbig migrering sedan.

### Förenklingen betalar sig två gånger

Kunden vill ha STEP-filer för sitt eget layoutarbete. Det de behöver är
**envelope-modellen** — ytterkontur och anslutningspunkter — inte den
detaljerade konstruktionen.

Det är samma förenklade kropp som ska tesselleras för webben. Alltså: ett
förenklingspass per maskin ger både webbmeshen och kundleveransen, och
skyddar konstruktions-IP på köpet. Planera det som ett steg, inte två.

---

## En detalj som är en solverändring, inte data

Katalogkortet i förslaget har `"dir": 180` — portriktning i grader. Vår
solver har `"x+" | "x-" | "y+" | "y-"`, alltså bara axelparallella portar.

Behövs verkligen godtyckliga vinklar — en transportör som går in i 30° — är
det inte ett dataformat som ska ändras utan kedjevandringen i
`src/lib/solver.ts`. Fullt görbart, men det är arbete i motorn och ny
diagnostik. **Ta beslutet medvetet.** Min gissning är att 90°-steg räcker för
pakethantering, och att grader bara flyttar in en felkälla.

---

## Teknikval, uppdaterat läge

| Val | Bedömning |
|---|---|
| **three.js WebGPURenderer** | Produktionsklar sedan r171 med automatisk WebGL2-fallback, och WebGPU finns numera i Chrome, Edge, Firefox och Safari. Använd den — men den räddar ingen som laddar 80 MB. Låt den inte bli anledningen att skjuta upp resten. |
| **Instansiering per SKU** | Ja. Det är den avgörande optimeringen i en anläggning, inte renderarvalet. |
| **HDRI + mjuka skuggor + AO** | Ja, men en enkel studio-HDRI räcker. Fotorealism säljer inte en pakethanteringslinje; läsbarhet gör det. |
| **PixiJS / Konva för 2D** | Nej, se punkt 1. |
| **meshopt** | Ja, framför Draco. |
| **KTX2** | Låg prioritet för de här modellerna. |

---

## Ordningen jag skulle jobba i

Planen som skrevs är allt-eller-inget. Konfiguratorn fungerar redan utan en
enda 3D-modell, så den kan levereras i etapper.

1. **Verkliga fotavtryck och portar för alla 17 maskiner.** Ingen CAD-pipeline
   behövs — det är mätvärden in i admin-vyn. Det här låser upp allt annat och
   är det enda som står mellan prototypen och något ni kan visa en kund.
2. **Förenklingspasset i CAD** för de 3–5 maskiner som finns med i de flesta
   offerter. Ger både envelope-STEP till kund och underlag till webben.
3. **Tessellera och exportera hero-GLB** för de maskinerna. Mät filstorlek och
   laddtid på riktigt innan resten görs.
4. **3D-vyn byggd på hero-GLB**, med instansiering och lat laddning per SKU.
   Behåll SVG-vyn som den är.
5. **Resten av maskinerna**, i den takt de dyker upp i verkliga förfrågningar.

Steg 1 är dagar av arbete och ger merparten av värdet. Steg 2–3 är där CAD-
tiden ligger. Bygg inte hela pipelinen innan ni vet att layouterna stämmer.

---

## Källor

- [What's New in Three.js (2026): WebGPU, New Workflows & Beyond](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [Migrate Three.js to WebGPU (2026) — The Complete Checklist](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [100 Three.js Tips That Actually Improve Performance (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [glTF Transform — komprimering och optimering av glTF](https://gltf-transform.dev/)
- [CAD interoperability around the glTF mesh format](https://www.cadinterop.com/en/formats/mesh/gltf.html)
- [Khronos glTF-Compressor](https://github.com/khronosgroup/gltf-compressor)
