# Från 80 MB STEP till en anläggning i webbläsaren

Analys av den föreslagna CAD-pipelinen, och vad jag skulle ändra.

> Kort version: grundplanen är rätt. Det mesta jag har att säga handlar om att
> göra **mindre** än vad som föreslås, i en annan ordning.

**Pipelinen är byggd och körs — och den körs från plattformen.** Välj
maskinens STEP-fil i admin-vyn så sköter webbläsaren resten: tessellering,
komprimering och mätvärden tillbaka. Filen laddas aldrig upp; bara den färdiga
modellen sparas. Samma konvertering finns som kommandoradsskript.
`tests/pipeline.test.ts` och `tests/models.test.ts` kör den skarpt vid varje
testkörning, mot en riktig STEP, och underkänner om något går sönder. Vyn
**Modell** i konfiguratorn laddar modellerna med three.js. Se
[Så kör du den](#så-kör-du-den) längst ned.

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

Det här är den praktiskt viktigaste punkten i hela analysen, och nu mätt.

Samma STEP-fil, samma skript, bara toleransen ändrad:

| Modell | 0,05 mm | 1 mm | 5 mm |
|---|---|---|---|
| Krökt kropp (turbinstjärt) | 8 548 tri | 516 tri | 254 tri |
| Plan sammansättning (18 delar) | 5 392 tri | 5 108 tri | 4 320 tri |

**Spaken är 15–35× på krökt geometri och nära noll på plana ytor.** En plan yta
tessellerar till två trianglar oavsett tolerans; det är fillets, cylindrar och
plåtbockningar som exploderar. En verklig maskin har gott om båda, så räkna med
en rejäl men ojämn vinst — och mät per maskin i stället för att gissa.

Att komprimera bort överskottet är att lösa fel problem. Ställ toleransen
rätt först, komprimera sedan.

Näst största spaken: **ta bort det som inte syns** innan tessellering.
Skruvar, lager, invändiga mekanismer, kablage. Det är där 80 MB kommer
ifrån. Skriptets `--min-part` gör det automatiskt: allt vars omslutande låda är
mindre än gränsen utelämnas, standard 50 mm. Det kräver ingen handpåläggning i
CAD, men en genomgång där ger ännu mer.

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

*Åtgärdat.*

Maskinbiblioteket lagras som ett JSON-dokument, i Postgres eller
versionshanterat i repot. Bilder ligger som base64 i det dokumentet, vilket är
rimligt för foton på några hundra kilobyte.

För GLB på 1–2 MB × 17 maskiner vore det fel: dokumentet läses vid *varje*
`/api/library` och `/api/price`, så tjugo megabyte modeller skulle göra varje
prisberäkning till en flerhundramegabytesläsning. Modellerna ligger därför i en
egen tabell, `machine_model`, med bara ett id i maskinen. `/api/models/<id>`
hämtar dem, och bara när vyn **Modell** öppnas.

Nästa steg när biblioteket är fullt är objektlagring (Cloudflare R2 eller S3) i
stället för `bytea` i Postgres. Det byter ut en funktion i `store.ts` — inte
datamodellen, för maskinen bär redan bara en URL.

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
| **three.js WebGPURenderer** | Produktionsklar sedan r171 med automatisk WebGL2-fallback, och WebGPU finns numera i Chrome, Edge, Firefox och Safari. Vyn använder i dag WebGLRenderer, vilket räcker gott för några tusen trianglar; bytet är en rad när det behövs. Den räddar ändå ingen som laddar 80 MB. |
| **Instansiering per SKU** | Ja. Det är den avgörande optimeringen i en anläggning, inte renderarvalet. |
| **HDRI + mjuka skuggor + AO** | Ja, men en enkel studio-HDRI räcker. Fotorealism säljer inte en pakethanteringslinje; läsbarhet gör det. |
| **PixiJS / Konva för 2D** | Nej, se punkt 1. |
| **meshopt** | Ja, framför Draco. |
| **KTX2** | Låg prioritet för de här modellerna. |

---

## Så kör du den

Det finns två vägar in, och de kör **samma kod**: `src/lib/cad/stepConvert.ts`.
Modulen är plattformsneutral — den körs i en web worker i webbläsaren och i
Node av skriptet — så de kan inte glida isär.

### Från admin-vyn — vanliga fallet

Öppna maskinen i admin, gå till panelen **3D-modell från STEP** och välj
maskinens STEP-fil. Konverteringen körs **i webbläsaren**, i en web worker på
den datorn. STEP-filen laddas aldrig upp; bara den färdiga GLB:n skickas till
servern, några hundra kilobyte i stället för åttio megabyte.

Panelen visar sedan:

- **Mätvärdena** — filstorlek in och ut, antal delar, trianglar, tid.
- **Varningarna** — fel längdenhet, orimlig höjd, för mycket geometri.
- **Måtten**, som tas över automatiskt. Modellen är ritningen: måtten ur den är
  mätta och inte uppskattade, så biblioteket följer konstruktionen i stället
  för tvärtom. Portarna skalas med — en port mitt på maskinen sitter mitt på
  även efteråt — och vilka som flyttades sägs rakt ut. Går måtten inte att
  spara, till exempel en modell i fel längdenhet som ger en 8 cm hög maskin,
  ändras ingenting och panelen säger varför.
- **Portförslaget**, som ligger mitt på kortsidorna. Det är räknat ur
  fotavtryckets kanter, inte ur geometrin — kontrollera det mot ritning.

Reglagen är desamma som skriptets: tolerans, minsta del, proxy.

#### Riktningen ställs efteråt, inte vid konverteringen

En STEP kommer sällan in rättvänd. CAD-system är oense om vilken axel som är
upp — SolidWorks och Inventor ritar Z upp, en del exportkedjor Y — och
konstruktören som ritade maskinen valde inte nödvändigtvis flödesriktningen
som X. Det är inte fel i filen, bara en annan konvention.

Riktningen gissas därför inte ur en konvention — den räknas fram. Vid
konverteringen provas alla fyra måttgivande lägen (Z eller Y upp, 0° eller 90°)
mot maskinens fotavtryck i biblioteket, och det som ger rätt form väljs.
Jämförelsen görs på **proportioner**, inte på absoluta mått: bibliotekets
siffror är ofta uppskattningar, och även den rätta riktningen kan då ligga
långt fel i meter medan formen ändå pekar entydigt. Skiljer formen inte lägena
åt — en nästan kvadratisk maskin — avstår verktyget och säger det, i stället
för att singla slant.

Kvar åt ögat är bara vilket håll maskinen pekar åt: ett halvt varv ändrar inga
mått, och spegling inte heller. Av 90° och 270° väljs den som lägger längden
längs +X — måtten kan inte skilja dem åt, men riktningen kan.

En fälla värd att känna till: vridningen måste ske kring den lodräta axeln,
alltså **efter** att modellen rests upp. three.js standardordning för Euler-
vinklar är XYZ, vilket ger matrisen Rx·Ry — vridning först, upprätning sedan —
och då hamnar uppriktningen vågrätt och maskinen ställer sig på högkant. Med
noll vridning märks det inte, så felet kan ligga kvar tills någon vrider en
modell ett kvarts varv. `orientationEuler` returnerar därför ordningen `YXZ`
tillsammans med vinklarna, och `tests/models.test.ts` räknar på den faktiska
rotationsmatrisen och kräver att uppriktningen står lodrätt vid varje
vridning. Upp-axel, vridning och spegling sitter på
maskinen och tillämpas vid uppritningen, med en 3D-förhandsgranskning i panelen
som visar ändringen direkt. Att vrida en modell rätt ska vara ett klick, inte en
runda till med filen. Måtten ur modellen permuteras med vridningen — reser man
en liggande modell byter bredd och höjd plats — så jämförelsen mot biblioteket
gäller den modell som faktiskt visas. Ett test kör samma STEP genom
konverterarens egen upp-axel och genom permutationen och kräver att de ger
identiska mått — de två vägarna får inte kunna säga olika saker.

#### Varför inte på servern

Första versionen tessellerade i webbservern. Den fungerade lokalt och gav
**502 utan läsbart innehåll** i drift, vilket är det svar man får när det inte
finns någon server kvar att svara.

Räkningen är enkel. Webbinstansen på Render har 512 MB. Next själv tar runt
110 MB. En uppladdad 80 MB-fil buffras av `formData()` och sedan en gång till
av `arrayBuffer()` — 160 MB innan något har hänt. Tesselleringen av en tung
sammanställning tar hundratals megabyte till. Då dödar cgroupen processen, och
en dödad process kastar inget fel som går att fånga: den försvinner, och
proxyn svarar 502. Felhanteringen i rutten var därför verkningslös — den
kunde aldrig köras.

En bärbar dator har 8–32 GB. Arbetet hör hemma där minnet finns. Att flytta
det till webbläsaren löser tre saker på en gång: uppladdningen försvinner,
serverns minnestak slutar spela roll, och en misslyckad konvertering kan inte
längre fälla sajten för alla andra.

Priset är att OpenCascades wasm — 7,6 MB — hämtas första gången någon
konverterar. Den kopieras till `public/occt/` vid bygget av
`scripts/copy-occt-wasm.mjs`, så den kan aldrig bli en annan version än den
`occt-import-js` i `node_modules` förväntar sig.

#### Utföranden

Samma maskin finns ofta i flera längder. En rullbana som 3, 6 och 12 meter är
inte tre maskiner i biblioteket utan en maskin med tre mått: samma
beskrivning, samma optioner, samma regler.

Varje utförande bär sin egen STEP-fil, och måtten kommer ur den. Utan egna
portlägen ärver utförandet maskinens, skalade till sitt mått — annars skulle en
tolvmetersbana ha sin utport där sexmetersbanan slutar, och kedjan byggas ihop
mitt på maskinen. Zonerna räknas om på samma sätt.

Upplösningen sker i `effectiveMachine`, före optioner och parametrar. Det är
avsiktligt: solvern, reglerna, prissättningen och 3D-vyn ser bara en maskin med
sina mått och behöver inte känna till utföranden alls.

Två saker att veta:

- **Priset ligger i prisboken**, aldrig i utförandet. Maskinbiblioteket går
  till webbläsaren; prisboken gör det aldrig. Saknas pris för ett utförande
  gäller maskinens grundpris, så ett nytt utförande fungerar innan
  prissättningen är gjord.
- **Utföranden slår steglös längd.** Har en maskin både och kan inte båda
  gälla, och det diskreta är det som finns att köpa: har någon lagt upp 3, 6
  och 12 meter är det de längderna som levereras.

**Var modellen hamnar.** GLB:n lagras i en egen tabell (`machine_model`) och
serveras av `/api/models/<id>`, aldrig i biblioteksdokumentet — se
[GLB hör inte hemma i biblioteksdokumentet](#glb-hör-inte-hemma-i-biblioteksdokumentet).
Utan `DATABASE_URL` ligger den bara i serverns minne och försvinner vid
omstart; panelen säger det rakt ut i stället för att låtsas att den är sparad.

### Från kommandoraden — sådant som ska in i repot

```bash
node scripts/step-to-glb.mjs maskiner/tsl-enkel.step \
  --id tsl-enkel --tolerance 2 --min-part 50
```

För modeller som ska versionshanteras med koden, och som en utväg om
webbläsaren skulle gå ur minnet på en riktigt tung sammanställning.

Skriver `public/models/tsl-enkel.glb` och `tsl-enkel.card.json`. Kortet
innehåller fotavtryck, höjd, ett portförslag och mätvärden — trianglar in,
filstorlek, hur många delar som utelämnades, hur lång tid det tog.

Klistra sedan in `/models/tsl-enkel.glb` i fältet **GLB** på maskinen i admin
och byt till vyn **Modell**.

### Vad konverteringen gör åt dig

- **Normaliserar geometrin.** Origo till inmatningsporten i golvnivå, X i
  flödesriktningen, Z upp, millimeter till meter. Samma konvention som solvern,
  så modellen och layouten hamnar på samma plats utan efterjustering.
- **Utelämnar smådelar** enligt `--min-part`.
- **Svetsar, avdubblar, kvantiserar och komprimerar** med meshopt.
- **Varnar för fel längdenhet.** Är största måttet under en halvmeter eller
  över sextio meter säger den till — tum tolkade som millimeter är det
  vanligaste felet i en STEP-leverans, och det syns direkt på
  storleksordningen.
- **Föreslår portar** på fotavtryckets kanter, och markerar kortet som
  `dimensionsVerified: false`. Portlägen är gissningar tills en konstruktör
  bekräftat dem.

### 3D-vyn granskar datan

Vyn **Modell** laddar varje SKU en gång och instansierar den, laddar lat vid
byte av vy, och ritar maskiner utan modell som sitt fotavtryck — så den
fungerar medan biblioteket fylls på.

Den skalar modellen likformigt till bibliotekets längd. Skiljer sig måtten mer
än fem procent säger den ifrån:

> **Modell och mått skiljer sig.** Truckströläggare – enkel: modellen är
> 0,20 × 0,15 m men biblioteket säger 4,20 × 5,00 m.

Det är inte en bugg utan poängen. 3D-vyn blir en kontroll av maskindatan, inte
bara en bild av den. Admin-vyn visar samma sak i siffror: hur många maskiner
som har kontrollerade mått, modell, bilder och beskrivning.

---

## Ordningen jag skulle jobba i

Planen som skrevs är allt-eller-inget. Konfiguratorn fungerar redan utan en
enda 3D-modell, så den kan levereras i etapper.

1. **Verkliga fotavtryck och portar för alla 17 maskiner.** Ingen CAD-pipeline
   behövs — det är mätvärden in i admin-vyn. Det här låser upp allt annat och
   är det enda som står mellan prototypen och något ni kan visa en kund.
2. **Kör skriptet på en riktig maskin-STEP.** Ta den tyngsta filen ni har.
   Notera trianglar, filstorlek och tid, och prova ett par toleranser. Efter en
   halvtimme vet ni om siffrorna håller — och det är det beskedet som gör det
   till ett säljargument i offerten i stället för ett löfte.
3. **Förenklingspasset i CAD** för de 3–5 maskiner som finns med i de flesta
   offerter. Ger både envelope-STEP till kund och underlag till webben.
4. **Resten av maskinerna**, i den takt de dyker upp i verkliga förfrågningar.

Steg 1 är dagar av arbete och ger merparten av värdet. Steg 2 är en halvtimme
och avgör om resten är värt att göra. Bygg inte hela pipelinen innan ni vet att
layouterna stämmer.

---

## Källor

- [What's New in Three.js (2026): WebGPU, New Workflows & Beyond](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [Migrate Three.js to WebGPU (2026) — The Complete Checklist](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [100 Three.js Tips That Actually Improve Performance (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [glTF Transform — komprimering och optimering av glTF](https://gltf-transform.dev/)
- [CAD interoperability around the glTF mesh format](https://www.cadinterop.com/en/formats/mesh/gltf.html)
- [Khronos glTF-Compressor](https://github.com/khronosgroup/gltf-compressor)
