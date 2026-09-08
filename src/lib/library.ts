import type { Machine, MachineCategory } from "./types";

/**
 * MASKINBIBLIOTEK — byggt ur INKAB:s produktkatalog, utgåva 1.
 *
 * Namn, funktion, beskrivningar, drivning, tekniska data och utföranden kommer
 * från katalogen och är INKAB:s egna uppgifter.
 *
 * FÖLJANDE ÄR FORTFARANDE UPPSKATTAT och måste ersättas med verkliga värden
 * innan verktyget visas för kund:
 *   - fotavtryck (längd, bredd, höjd) och portarnas lägen
 *   - kapacitet i paket/h
 *   - effekt där katalogen inte anger den
 *   - fundament, punktlast och gropdjup
 *   - leveranstider
 * Maskiner med dimensionsVerified: false har uppskattade mått. Fältet syns i
 * admin-vyn så att det går att se vad som återstår.
 *
 * Priser ligger inte här — se src/lib/server/pricebook.ts.
 */

export const BUILTIN_MACHINES: Machine[] = [
  {
    id: "tsl-enkel",
    sku: "TSL-E",
    name: "Truckströläggare – enkel",
    category: "stickers",
    summary: "Lägger ett truckströ ovanpå paketet. Portal, magasin och transportörer.",
    aiDescription:
      "En portalmaskin som automatiskt placerar ett truckströ ovanpå virkespaketet när paketet stannar för bandning, eller vid ett stopp som är särskilt avsett för truckströläggning. Portalen har ett pneumatiskt gripdon; vagn och grip drivs av servomotorer.\n" +
      "Den löser den manuella hanteringen av truckströläggning och tar bort behovet av en operatörsinsats vid varje paketstopp. Operatören behöver bara fylla på magasinet under drift.\n" +
      "Magasinets storlek och placering anpassas efter tillgängligt utrymme — det kan stå på båda sidor av rullbanan, vilket är den fråga kunden svarar på i konfiguratorn.\n" +
      "Välj den här när kunden behöver ett truckströ per paket. Vid högre kapacitetsbehov eller flera strön per paket, välj Truckströläggare – multi i stället.",
    catalogueNumber: "01",
    dimensionsVerified: false,

    footprint: { lengthMm: 4200, widthMm: 5000, heightMm: 4200 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 2500 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 4200, y: 2500 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 5,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1500, l: 4200, w: 1500 },
        label: "Service och magasinpåfyllning",
      },
      {
        type: "safety",
        box: { x: -700, y: -700, l: 4200 + 1400, w: 5000 + 1400 },
        label: "Skyddszon portal",
      },
    ],
    clearance: { frontMm: 800, backMm: 800, leftMm: 1500, rightMm: 1500 },

    capacity: {
      packagesPerHour: 18,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 9.0, airNlPerMin: 260 },
    foundation: { pitDepthMm: 0, pointLoadKn: 70 },
    requires: ["strofacksmagasin"],
    stepFile: "TSL-E.step",
    leadTimeWeeks: 26,

    parameters: [
      {
        id: "takt",
        label: "Önskad virkestakt",
        type: "number",
        affects: "capacity",
        unit: "paket/h",
        help: "Dimensionerande takt. Styr maskinens kapacitet i layouten.",
        min: 6,
        max: 30,
        step: 1,
        defaultNumber: 18,
      },
      {
        id: "stro_bredd",
        label: "Truckströts bredd",
        type: "number",
        unit: "mm",
        help: "Katalogens intervall: 45–70 mm.",
        min: 45,
        max: 70,
        step: 1,
        defaultNumber: 60,
      },
      {
        id: "stro_hojd",
        label: "Truckströts höjd",
        type: "number",
        unit: "mm",
        help: "Katalogens intervall: 45–100 mm.",
        min: 45,
        max: 100,
        step: 1,
        defaultNumber: 70,
      },
      {
        id: "stro_langd",
        label: "Truckströts längd",
        type: "number",
        unit: "mm",
        help: "Katalogens intervall: 800–1150 mm.",
        min: 800,
        max: 1150,
        step: 10,
        defaultNumber: 1000,
      },
    ],
    options: [
      { id: "magasin-stort", name: "Större magasin", deltaWidthMm: 900 },
    ],
  },
  {
    id: "tsl-multi",
    sku: "TSL-M",
    name: "Truckströläggare – multi",
    category: "stickers",
    summary: "Lägger ett eller flera truckströ per stopp. Portal, magasin, paternosterverk.",
    aiDescription:
      "En portalmaskin som placerar ett eller flera truckströ på virkespaketet vid varje bandningsstopp. Antalet strön per stopp avgörs av vald design. Maskinen består av portal, magasin, paternosterverk och transportörer.\n" +
      "Den är byggd för högre kapacitetsbehov än den enkla varianten. Ett vakuumlyft lyfter ett helt lager truckströ från en pall till magasinet, vilket i praktiken tar bort den manuella efterfyllningen: operatören kör in en pall i cellen och maskinen sköter utläggningen tills pallen är tom.\n" +
      "PLC-programmet har upp till 48 justerbara positioner för placering av truckströ. Maskinen är CE-märkt och levereras med maskinsäkerhet i form av nät, grindar och ljusbommar — det gör att den kräver större fritt utrymme runt sig än den enkla.\n" +
      "Magasinet kan placeras på båda sidor av rullbanan.\n" +
      "Välj den här framför den enkla när kunden kör hög takt, behöver flera strön per paket, eller vill slippa manuell magasinpåfyllning.",
    catalogueNumber: "02",
    dimensionsVerified: false,

    footprint: { lengthMm: 6400, widthMm: 6800, heightMm: 4600 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 3400 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 6400, y: 3400 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 5,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1800, l: 6400, w: 1800 },
        label: "Service och pallinkörning",
      },
      {
        type: "safety",
        box: { x: -900, y: -900, l: 6400 + 1800, w: 6800 + 1800 },
        label: "Skyddszon nät och ljusbommar",
      },
    ],
    clearance: { frontMm: 1000, backMm: 1000, leftMm: 2000, rightMm: 2000 },

    capacity: {
      packagesPerHour: 26,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 15.0, airNlPerMin: 340 },
    foundation: { pitDepthMm: 0, pointLoadKn: 95 },
    requires: ["strofacksmagasin"],
    stepFile: "TSL-M.step",
    leadTimeWeeks: 30,

    parameters: [
      {
        id: "takt",
        label: "Önskad virkestakt",
        type: "number",
        affects: "capacity",
        unit: "paket/h",
        help: "Dimensionerande takt. Styr maskinens kapacitet i layouten.",
        min: 10,
        max: 40,
        step: 1,
        defaultNumber: 26,
      },
      {
        id: "stron_per_paket",
        label: "Antal truckströ per paket",
        type: "number",
        unit: "st",
        min: 1,
        max: 4,
        step: 1,
        defaultNumber: 2,
      },
      {
        id: "stro_bredd",
        label: "Truckströts bredd",
        type: "number",
        unit: "mm",
        help: "Katalogens intervall för multi: 45–55 mm.",
        min: 45,
        max: 55,
        step: 1,
        defaultNumber: 50,
      },
    ],
    options: [
      { id: "vakuumlyft-extra", name: "Extra vakuumlyft", deltaLengthMm: 1200, deltaPowerKw: 2.5 },
    ],
  },
  {
    id: "underslagslaggare",
    sku: "USL",
    name: "Underslagsläggare",
    category: "stickers",
    summary: "Bandar fast spårade truckströ under paketet, som del av bandningen.",
    aiDescription:
      "Ett maskinsystem som matar in spårade truckströ under virkespaketet och bandar fast dem som en del av bandningsprocessen. Strön matas in via inmatningstransportören, förs över bandramen och lyfts upp i position för fastbandning.\n" +
      "Den automatiserar ett moment som annars kräver manuell hantering. Truckströna är 60 mm breda och 45–70 mm höga, och spåret ska vara 10–15 mm bredare än plastbandet.\n" +
      "Magasinet är som standard integrerat med överslagsläggaren. Ett separat magasin enbart för underslagsläggaren finns som tillval.\n" +
      "Underslagsläggaren lägger strön UNDER paketet, till skillnad från truckströläggarna som lägger dem ovanpå. De kombineras ofta i samma linje.",
    catalogueNumber: "03",
    dimensionsVerified: false,

    footprint: { lengthMm: 4600, widthMm: 4200, heightMm: 2400 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 2100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 4600, y: 2100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 5,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1400, l: 4600, w: 1400 },
        label: "Service och magasin",
      },
    ],
    clearance: { frontMm: 800, backMm: 800, leftMm: 1200, rightMm: 1200 },

    capacity: {
      packagesPerHour: 20,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 7.5, airNlPerMin: 280 },
    foundation: { pitDepthMm: 300, pointLoadKn: 55 },
    stepFile: "USL.step",
    leadTimeWeeks: 24,

    parameters: [
      {
        id: "stro_hojd",
        label: "Truckströts höjd",
        type: "number",
        unit: "mm",
        help: "Katalogens intervall: 45–70 mm.",
        min: 45,
        max: 70,
        step: 1,
        defaultNumber: 60,
      },
      {
        id: "spar_overmatt",
        label: "Spårets övermått mot bandet",
        type: "number",
        unit: "mm",
        help: "Spåret ska vara 10–15 mm bredare än plastbandet.",
        min: 10,
        max: 15,
        step: 1,
        defaultNumber: 12,
      },
    ],
    options: [
      { id: "separat-magasin", name: "Separat magasin för underslagsläggaren", deltaWidthMm: 1800 },
    ],
  },
  {
    id: "rullbana-underslag",
    sku: "RB-USL",
    name: "Rullbana och kedjekanaler till underslagsläggaren",
    category: "transport",
    summary: "Höj- och sänkbar transportör genom underslagsläggaren. Hydraulik eller 100 % el.",
    aiDescription:
      "En transportörsenhet med rullbana och brutna kedjekanaler som ansluts till underslagsläggaren. Den transporterar virkespaket, med eller utan truckströ under paketet, genom underslagsläggaren.\n" +
      "Det avgörande är att transportören är höj- och sänkbar: den anpassas efter truckströnas tjocklek. De brutna kedjekanalerna gör att enheten kan anslutas till kundens befintliga kedjetransportör för paket ut.\n" +
      "Finns i två utföranden. Hydraulisk version med hydraulaggregat, eller helt eldriven version (100 % el) med elektriska ställdon, SEW kuggväxlar och givare — ingen hydraulik alls. Valet styrs av kundens inställning till hydraulik i anläggningen.\n" +
      "Den här enheten hör ihop med underslagsläggaren och väljs normalt tillsammans med den.",
    catalogueNumber: "04",
    dimensionsVerified: false,

    footprint: { lengthMm: 6000, widthMm: 3000, heightMm: 1400 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 1500 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 6000, y: 1500 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 1,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1000, l: 6000, w: 1000 },
        label: "Service transportör",
      },
    ],
    clearance: { frontMm: 600, backMm: 600, leftMm: 1000, rightMm: 1000 },

    capacity: {
      packagesPerHour: 24,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 6.0, airNlPerMin: 0 },
    foundation: { pitDepthMm: 400, pointLoadKn: 45 },
    stepFile: "RB-USL.step",
    leadTimeWeeks: 22,

    parameters: [
      {
        id: "drivning",
        label: "Drivning",
        type: "select",
        help: "Elversionen har inga hydraulaggregat i anläggningen.",
        choices: [
          { value: "hydraulik", label: "Hydraulisk höj/sänk" },
          { value: "el", label: "100 % el, elektriska ställdon", priceDelta: 74000 },
        ],
        defaultText: "el",
      },
    ],
    options: [
    ],
  },
  {
    id: "paketlyft-fast",
    sku: "PL-F",
    name: "Paketlyft med fast stativ",
    category: "processing",
    summary: "Lyfter paket med 4 gafflar. Fast monterad i betong- eller balkfundament.",
    aiDescription:
      "En paketlyft med fast stativ och fyra lyftgafflar, byggd kring ett kraftigt balkstativ monterat direkt i betong- eller balkfundament. En 70 mm axel bär lyftkedjorna och drivningen sker via en SEW kuggväxel med broms.\n" +
      "De fyra lyftkedjorna har individuella höjdjusteringar, vilket ger kontrollerad lyftning även när paketet är ojämnt. Gafflarna är testade och godkända för två hela paket i längd 5,4 meter.\n" +
      "Den är fast monterad — kan alltså inte flyttas i sidled. Behöver kunden köra gafflarna in och ut ur rullbanan ska Paketlyft monterad på vagn väljas i stället.\n" +
      "Kräver fundament och därför besked om golvets bärighet tidigt i projektet.",
    catalogueNumber: "05",
    dimensionsVerified: false,

    footprint: { lengthMm: 2600, widthMm: 6200, heightMm: 5200 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 3100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 2600, y: 3100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 3,

    zones: [
      {
        type: "safety",
        box: { x: -800, y: -800, l: 2600 + 1600, w: 6200 + 1600 },
        label: "Skyddszon lyft",
      },
      {
        type: "pit",
        box: { x: 0, y: 0, l: 2600, w: 6200 },
        label: "Fundament",
      },
    ],
    clearance: { frontMm: 1000, backMm: 1000, leftMm: 1500, rightMm: 1500 },

    capacity: {
      packagesPerHour: 16,
      packageLengthMm: [2400, 5400],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3500,
    },
    utilities: { powerKw: 11.0, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 180 },
    stepFile: "PL-F.step",
    leadTimeWeeks: 28,

    parameters: [
      {
        id: "lyfthojd",
        label: "Lyfthöjd",
        type: "number",
        unit: "mm",
        min: 1000,
        max: 4000,
        step: 100,
        defaultNumber: 2500,
      },
    ],
    options: [
    ],
  },
  {
    id: "paketlyft-vagn",
    sku: "PL-V",
    name: "Paketlyft, monterad på vagn",
    category: "processing",
    summary: "Lyfter paket med 4 gafflar. Vagn kör gafflarna in och ut ur rullbanan.",
    aiDescription:
      "Samma lyftprincip som den fasta paketlyften — fyra gafflar, fyra lyftkedjor med individuella höjdjusteringar, 70 mm axel — men balkstativet är monterat på en vagn med kedjetransmission. Vagnen kör gafflarna in och ut ur rullbanan. Drivningen sker via två SEW kuggväxlar med broms.\n" +
      "Gafflarna är testade och godkända för två hela paket i längd 5,4 meter.\n" +
      "Välj den här när gafflarna måste kunna dras undan från rullbanan, till exempel när linjen ska kunna köra paket förbi lyften utan att den är i vägen. Den kräver mer utrymme i sidled än den fasta varianten eftersom vagnen ska ha körväg.",
    catalogueNumber: "06",
    dimensionsVerified: false,

    footprint: { lengthMm: 4400, widthMm: 6200, heightMm: 5200 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 3100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 4400, y: 3100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 3,

    zones: [
      {
        type: "safety",
        box: { x: -800, y: -800, l: 4400 + 1600, w: 6200 + 1600 },
        label: "Skyddszon lyft och vagn",
      },
      {
        type: "service",
        box: { x: 0, y: -1600, l: 4400, w: 1600 },
        label: "Vagnens körväg",
      },
    ],
    clearance: { frontMm: 1000, backMm: 1000, leftMm: 2200, rightMm: 2200 },

    capacity: {
      packagesPerHour: 16,
      packageLengthMm: [2400, 5400],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3500,
    },
    utilities: { powerKw: 15.0, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 190 },
    stepFile: "PL-V.step",
    leadTimeWeeks: 30,

    parameters: [
      {
        id: "lyfthojd",
        label: "Lyfthöjd",
        type: "number",
        unit: "mm",
        min: 1000,
        max: 4000,
        step: 100,
        defaultNumber: 2500,
      },
      {
        id: "vagnslag",
        label: "Vagnens slaglängd",
        type: "number",
        unit: "mm",
        min: 1000,
        max: 4000,
        step: 100,
        defaultNumber: 2200,
      },
    ],
    options: [
    ],
  },
  {
    id: "sidoskyddslaggare",
    sku: "SSL",
    name: "Sidoskyddsläggare",
    category: "finishing",
    summary: "Bandar fast sidoskyddsbrädor på paketets sidor. Justerbart presstryck.",
    aiDescription:
      "En maskin som automatiskt placerar och bandar fast sidoskyddsbrädor på sidorna av virkespaketen. Operatören laddar brädor manuellt i magasin på vardera sida om rullbanan; så länge det finns material sker positioneringen automatiskt.\n" +
      "Brädorna pressas med justerbart tryck mot paketets sidor. Maskinen hanterar sidoskyddsbrädor från 150 mm längd och uppåt.\n" +
      "Eftersom magasinen sitter på båda sidor om banan behöver maskinen fritt utrymme åt båda hållen för påfyllning — det påverkar var pulpet och truckgata kan ligga.",
    catalogueNumber: "07",
    dimensionsVerified: false,

    footprint: { lengthMm: 3600, widthMm: 4600, heightMm: 2600 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 2300 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 3600, y: 2300 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 3,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1800, l: 3600, w: 1800 },
        label: "Magasinpåfyllning vänster",
      },
      {
        type: "service",
        box: { x: 0, y: 4600, l: 3600, w: 1800 },
        label: "Magasinpåfyllning höger",
      },
    ],
    clearance: { frontMm: 700, backMm: 700, leftMm: 1800, rightMm: 1800 },

    capacity: {
      packagesPerHour: 20,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 5.5, airNlPerMin: 300 },
    foundation: { pitDepthMm: 0, pointLoadKn: 40 },
    stepFile: "SSL.step",
    leadTimeWeeks: 22,

    parameters: [
      {
        id: "presstryck",
        label: "Presstryck mot paketets sida",
        type: "number",
        unit: "bar",
        help: "Justerbart enligt katalogen.",
        min: 2,
        max: 8,
        step: 1,
        defaultNumber: 5,
      },
      {
        id: "bradlangd",
        label: "Minsta brädlängd",
        type: "number",
        unit: "mm",
        help: "Maskinen hanterar brädor från 150 mm och uppåt.",
        min: 150,
        max: 1200,
        step: 10,
        defaultNumber: 150,
      },
    ],
    options: [
    ],
  },
  {
    id: "paketpress-hydraulisk",
    sku: "PP-H",
    name: "Hydraulisk paketpress",
    category: "processing",
    summary: "Pressar paketet från sidorna och ovanifrån. Två vertikala och en horisontell balk.",
    aiDescription:
      "En paketpress med två vertikala och en horisontell pressbalk, driven av ett hydraulaggregat med ventiler och ställbara tryckbegränsningsventiler. Den monteras före eller efter bandramen och pressar samman paketet med inställt tryck när det stannar.\n" +
      "Operatören kan välja mellan tre körlägen: alla tre balkar pressar, enbart de två vertikala, eller enbart den horisontella. Inställbart tryck 30–100 bar, där 100 bar ger cirka 6 tons presskraft.\n" +
      "Hydrauliken finns i två versioner. Version 1 har tryckkompenserad kolvpump driven av 11 kW motor, med elstyrda tryckbegränsningsventiler och digital tryckomställning — trycket kan ändras snabbt mellan olika körningar, via potentiometer eller direkt på pekskärmen. Version 2 har kugghjulspump, också 11 kW, med mekaniskt justerbara ventiler; den medger inte snabba anpassningar mellan körningar.\n" +
      "Välj version 1 när kunden kör blandade dimensioner och behöver byta tryck ofta. Behöver kunden bara sidopress och inte press ovanifrån räcker Lättpressen, som är pneumatisk och betydligt enklare.",
    catalogueNumber: "08",
    dimensionsVerified: false,

    footprint: { lengthMm: 3200, widthMm: 4400, heightMm: 3800 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 2200 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 3200, y: 2200 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 3,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1400, l: 3200, w: 1400 },
        label: "Service hydraulaggregat",
      },
      {
        type: "safety",
        box: { x: -600, y: -600, l: 3200 + 1200, w: 4400 + 1200 },
        label: "Skyddszon press",
      },
    ],
    clearance: { frontMm: 800, backMm: 800, leftMm: 1400, rightMm: 1400 },

    capacity: {
      packagesPerHour: 18,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3500,
    },
    utilities: { powerKw: 11.0, airNlPerMin: 0 },
    foundation: { pitDepthMm: 400, pointLoadKn: 120 },
    conflictsWith: ["lattpress"],
    stepFile: "PP-H.step",
    leadTimeWeeks: 26,

    parameters: [
      {
        id: "hydraulversion",
        label: "Hydraulversion",
        type: "select",
        help: "Version 1 låter operatören byta tryck snabbt mellan körningar.",
        choices: [
          { value: "v1", label: "Version 1 – kolvpump, digital tryckomställning", priceDelta: 96000 },
          { value: "v2", label: "Version 2 – kugghjulspump, mekanisk justering" },
        ],
        defaultText: "v1",
      },
      {
        id: "presstryck",
        label: "Presstryck",
        type: "number",
        unit: "bar",
        help: "100 bar ger cirka 6 tons presskraft.",
        min: 30,
        max: 100,
        step: 5,
        defaultNumber: 80,
      },
      {
        id: "korlage",
        label: "Körläge",
        type: "select",
        choices: [
          { value: "alla", label: "Alla tre balkar pressar" },
          { value: "vertikala", label: "Endast de två vertikala balkarna" },
          { value: "horisontell", label: "Endast den horisontella balken" },
        ],
        defaultText: "alla",
      },
    ],
    options: [
    ],
  },
  {
    id: "lattpress",
    sku: "LP",
    name: "Lättpress – paketpress",
    category: "processing",
    summary: "Pneumatisk sidopress med två vertikala pressbalkar.",
    aiDescription:
      "En paketpress med två vertikala pressbalkar för sidopress av virkespaket, driven av pneumatik. Den monteras före eller efter bandramen.\n" +
      "Stativet är i HEB100-balk och pressbalkarna i KKR-rör. Två vagnar med lagrade, justerbara stålhjul bär balkarna. Två cylindrar med diameter 100 mm ger slaglängd 2 × 350 mm och en presskraft på cirka 600 kg vid 8 bar. Levereras klar för inkoppling med luftventil och givare.\n" +
      "Den pressar bara från sidorna — inte ovanifrån. Behöver kunden press även ovanifrån, eller mycket högre presskraft, är det den hydrauliska paketpressen som gäller. Lättpressen är snabbare, enklare och kräver ingen hydraulik i anläggningen.",
    catalogueNumber: "09",
    dimensionsVerified: false,

    footprint: { lengthMm: 2600, widthMm: 4000, heightMm: 3000 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 2000 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 2600, y: 2000 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 3,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1200, l: 2600, w: 1200 },
        label: "Service lättpress",
      },
    ],
    clearance: { frontMm: 600, backMm: 600, leftMm: 1200, rightMm: 1200 },

    capacity: {
      packagesPerHour: 24,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 1.5, airNlPerMin: 420 },
    foundation: { pitDepthMm: 0, pointLoadKn: 35 },
    conflictsWith: ["paketpress-hydraulisk"],
    stepFile: "LP.step",
    leadTimeWeeks: 18,

    parameters: [
      {
        id: "lufttryck",
        label: "Lufttryck",
        type: "number",
        unit: "bar",
        help: "8 bar ger cirka 600 kg presskraft enligt katalogen.",
        min: 4,
        max: 8,
        step: 1,
        defaultNumber: 8,
      },
    ],
    options: [
    ],
  },
  {
    id: "emballageutlaggare",
    sku: "EMB",
    name: "Emballageutläggare",
    category: "finishing",
    summary: "Rullar ut och kapar täckplast. Två utmatningsrullar och två knivar.",
    aiDescription:
      "En maskin som matar ut och kapar täckplast över virkespaket. Plasten matas ut via belagda utmatningsrullar drivna av SEW kuggväxlar; gummihjul pressar plasten mot rullarna för stabil utmatning, och en pneumatiskt styrd kniv klipper av den.\n" +
      "Två utmatningsrullar och två knivar gör att maskinen hanterar två olika plastbredder utan omställning. Det finns plats för 2 + 2 plastrullar — två rullar per hållare, en hållare över varje utmatningsrulle. Max längd på plastrullen i standardutförande är 2600 mm.\n" +
      "Stativet kan sänkas ner hydrauliskt vid laddning av rullar och vid service, vilket kräver fritt utrymme ovanför och framför maskinen.\n" +
      "Placeras sist i linjen, efter bandning, när paketen ska levereras väderskyddade.",
    catalogueNumber: "10",
    dimensionsVerified: false,

    footprint: { lengthMm: 2200, widthMm: 3800, heightMm: 3400 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 1900 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 2200, y: 1900 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 3,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1500, l: 2200, w: 1500 },
        label: "Laddning av plastrullar",
      },
    ],
    clearance: { frontMm: 1200, backMm: 800, leftMm: 1400, rightMm: 1400 },

    capacity: {
      packagesPerHour: 20,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 4.0, airNlPerMin: 240 },
    foundation: { pitDepthMm: 0, pointLoadKn: 45 },
    stepFile: "EMB.step",
    leadTimeWeeks: 24,

    parameters: [
      {
        id: "plastbredd",
        label: "Plastrullens längd",
        type: "number",
        unit: "mm",
        help: "Standardutförandets max är 2600 mm.",
        min: 1200,
        max: 2600,
        step: 100,
        defaultNumber: 2600,
      },
    ],
    options: [
    ],
  },
  {
    id: "rullbana",
    sku: "RB",
    name: "Rullbana – fast bana med drivna rullar",
    category: "transport",
    summary: "Transporterar paket på drivna rullar. Byggs i sektioner om 6 m eller kortare.",
    aiDescription:
      "En fast rullbana med drivna rullar, byggd i sektioner om 6 meter eller kortare. Rullarna är 127 × 4 mm, ramen i UPE180, och drivningen sker med elmotor 2,2 kW via växellåda.\n" +
      "Konstruktionen är öppen mellan rullarna, vilket tillåter passage och ger god ergonomi för operatören — det gör den lämplig där personal ska kunna ta sig över eller under banan.\n" +
      "Längden är fri i konfiguratorn eftersom banan byggs i sektioner. Behöver kunden transportera tyngre paket eller längre sträckor är kedjetransportören med mittdrift det stabilare valet.",
    catalogueNumber: "11",
    dimensionsVerified: false,

    footprint: { lengthMm: 6000, widthMm: 1800, heightMm: 700 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 900 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 6000, y: 900 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    parametricLength: { minMm: 2000, maxMm: 30000, pricePerMeter: 18000 },
    operatorPriority: 1,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -800, l: 6000, w: 800 },
        label: "Service rullbana",
      },
    ],
    clearance: { frontMm: 400, backMm: 400, leftMm: 800, rightMm: 800 },

    capacity: {
      packagesPerHour: 30,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 2500,
    },
    utilities: { powerKw: 2.2, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 16 },
    stepFile: "RB.step",
    leadTimeWeeks: 14,
    options: [
    ],
  },
  {
    id: "kedjetransportor",
    sku: "KT-M",
    name: "Kedjetransportör med mittdrift",
    category: "transport",
    summary: "Kedjetransport av paket. Kedjekanaler KKR 60×12×4 mm, mittdrift.",
    aiDescription:
      "En kedjetransportör där rullkedjan löper i kedjekanaler av KKR 60 × 12 × 4 mm på en plåtränna med E-list, med returen inne i kanalen — en kompakt konstruktion.\n" +
      "Mittdriften driver kedjan via en axel på 40 eller 50 mm, lagrad med UCF flänslager och driven av en SEW kuggväxel. Kedjesträckningen justeras i mittdriftens plåtar och är lätt att komma åt. Vändhjulen har dubbla rullager för lång, problemfri drift.\n" +
      "Detta är linjens arbetshäst för längre transporter och den maskin som normalt används som buffert före utlastningen. Längden är fri och styrs antingen av kundens svar på frågan om sista kedjetransportören, eller sätts automatiskt så att linjen slutar i den punkt kunden pekat ut i ritningen.\n" +
      "Som tumregel ska bufferten rymma minst två paketlängder, annars stannar linjen så fort trucken dröjer.",
    catalogueNumber: "12",
    dimensionsVerified: false,

    footprint: { lengthMm: 12000, widthMm: 2200, heightMm: 800 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 1100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 12000, y: 1100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    parametricLength: { minMm: 3000, maxMm: 40000, pricePerMeter: 21000 },
    operatorPriority: 1,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -900, l: 12000, w: 900 },
        label: "Service kedjetransportör",
      },
    ],
    clearance: { frontMm: 400, backMm: 400, leftMm: 900, rightMm: 900 },

    capacity: {
      packagesPerHour: 32,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3500,
    },
    utilities: { powerKw: 4.0, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 20 },
    stepFile: "KT-M.step",
    leadTimeWeeks: 16,

    parameters: [
      {
        id: "axel",
        label: "Mittdriftens axel",
        type: "select",
        help: "Grövre axel för tyngre paket.",
        choices: [
          { value: "40", label: "40 mm" },
          { value: "50", label: "50 mm", priceDelta: 18000 },
        ],
        defaultText: "40",
      },
    ],
    options: [
    ],
  },
  {
    id: "kedjekanal-hojsank",
    sku: "KT-HS",
    name: "Kedjekanaler, mittdrift, höj- och sänkbar",
    category: "transport",
    summary: "Kedjetransport med pneumatisk höj/sänk via lyftstativ med luftbälgar.",
    aiDescription:
      "Samma kedjetransportprincip som mittdriftstransportören — rullkedja i KKR-kanaler på plåtränna med E-list, retur inne i kanalen, mittdrift med 40 eller 50 mm axel, UCF flänslager och SEW kuggväxel — men kanalerna är ledade med bussningar och axlar och kan höjas och sänkas.\n" +
      "Höj- och sänkrörelsen sker med ett lyftstativ med luftbälgar, styrt med pneumatik och givare.\n" +
      "Välj den här när paketet måste byta nivå i linjen, till exempel för att lämna över till en maskin på annan höjd eller för att passera under något. På raka sträckor där nivån är konstant räcker den vanliga kedjetransportören, som är billigare och enklare.",
    catalogueNumber: "13",
    dimensionsVerified: false,

    footprint: { lengthMm: 4000, widthMm: 2200, heightMm: 1200 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 1100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 4000, y: 1100 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 1,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1000, l: 4000, w: 1000 },
        label: "Service och luftbälgar",
      },
    ],
    clearance: { frontMm: 500, backMm: 500, leftMm: 1000, rightMm: 1000 },

    capacity: {
      packagesPerHour: 26,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3500,
    },
    utilities: { powerKw: 4.0, airNlPerMin: 320 },
    foundation: { pitDepthMm: 300, pointLoadKn: 28 },
    stepFile: "KT-HS.step",
    leadTimeWeeks: 20,

    parameters: [
      {
        id: "axel",
        label: "Mittdriftens axel",
        type: "select",
        choices: [
          { value: "40", label: "40 mm" },
          { value: "50", label: "50 mm", priceDelta: 18000 },
        ],
        defaultText: "40",
      },
      {
        id: "slaglangd",
        label: "Höj/sänk-slaglängd",
        type: "number",
        unit: "mm",
        min: 100,
        max: 800,
        step: 50,
        defaultNumber: 300,
      },
    ],
    options: [
    ],
  },
  {
    id: "bandomforing",
    sku: "BOS",
    name: "Bandomföringsstation",
    category: "finishing",
    summary: "Matar och för om bandet vid bandning. Fromms E101, bandram i HD 1000.",
    aiDescription:
      "En station för bandomföring med en Fromms E101-motor för bandmatning och en bandram i plast HD 1000 med fjädrande vingar i rostfri plåt.\n" +
      "Bandmaskinen hängs upp i en arm kopplad till ett balansblock, vilket gör den lätt att hantera och positionera. Operatören manövrerar bandmatningen via en knappdosa med nödstopp medan motorn sköter matningen genom bandramen.\n" +
      "Elskåpet innehåller huvudbrytare, nätaggregat 24 VDC, reläer och plintar. Elritningar levereras i Elprocad tillsammans med serviceunderlag, bruksanvisning och reservdelslista.\n" +
      "Bandavrullare samt anslutning av luft och el tillkommer.\n" +
      "Det här är den manuellt manövrerade varianten. Ska bandomföringen ske automatiskt är det varianten med pneumatiskt spjut som gäller.",
    catalogueNumber: "14",
    dimensionsVerified: false,

    footprint: { lengthMm: 1600, widthMm: 3400, heightMm: 3000 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 1700 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 1600, y: 1700 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 3,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1400, l: 1600, w: 1400 },
        label: "Operatörsplats bandning",
      },
    ],
    clearance: { frontMm: 600, backMm: 600, leftMm: 1200, rightMm: 1200 },

    capacity: {
      packagesPerHour: 22,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 2.2, airNlPerMin: 380 },
    foundation: { pitDepthMm: 0, pointLoadKn: 25 },
    conflictsWith: ["bandomforing-spjut"],
    stepFile: "BOS.step",
    leadTimeWeeks: 16,

    parameters: [
      {
        id: "antal_band",
        label: "Antal band per paket",
        type: "number",
        unit: "st",
        min: 2,
        max: 6,
        step: 1,
        defaultNumber: 2,
      },
    ],
    options: [
    ],
  },
  {
    id: "bandomforing-spjut",
    sku: "BOS-S",
    name: "Bandomföringsstation med spjut",
    category: "finishing",
    summary: "Bandomföring med pneumatiskt spjut, slaglängd 1000 mm.",
    aiDescription:
      "Samma bandomföringsstation som grundvarianten — Fromms E101-motor, bandram i plast HD 1000 med vingar i rostfri plåt, upphängning i arm med balansblock, knappdosa med nödstopp — men kompletterad med ett pneumatiskt drivet spjut med slaglängd 1000 mm.\n" +
      "Spjutet förs in och automatiserar själva bandomföringen, vilket tar bort ett manuellt moment per band och därmed höjer takten.\n" +
      "Elskåpet innehåller huvudbrytare, nätaggregat 24 VDC, reläer och plintar, med elritningar i Elprocad. Bandavrullare samt anslutning av luft och el tillkommer.\n" +
      "Välj den här framför grundvarianten när kunden kör hög takt eller vill minska operatörsberoendet vid bandningen. Spjutet kräver fritt utrymme för slaglängden.",
    catalogueNumber: "15",
    dimensionsVerified: false,

    footprint: { lengthMm: 1900, widthMm: 3600, heightMm: 3000 },
    ports: [
      {
        id: "in",
        role: "in",
        pos: { x: 0, y: 1800 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
      {
        id: "out",
        role: "out",
        pos: { x: 1900, y: 1800 },
        dir: "x+",
        levelMm: 900,
        widthMm: [600, 1600],
        allowsDirectionChange: false,
      },
    ],
    mirrorable: true,
    operatorPriority: 3,

    zones: [
      {
        type: "service",
        box: { x: 0, y: -1400, l: 1900, w: 1400 },
        label: "Operatörsplats bandning",
      },
      {
        type: "safety",
        box: { x: 0, y: -200, l: 1900 + 1400, w: 3600 + 400 },
        label: "Spjutets slagområde",
      },
    ],
    clearance: { frontMm: 1200, backMm: 600, leftMm: 1300, rightMm: 1300 },

    capacity: {
      packagesPerHour: 28,
      packageLengthMm: [2400, 6000],
      packageWidthMm: [800, 1150],
      packageHeightMm: [300, 1200],
      maxWeightKg: 3000,
    },
    utilities: { powerKw: 2.2, airNlPerMin: 520 },
    foundation: { pitDepthMm: 0, pointLoadKn: 28 },
    conflictsWith: ["bandomforing"],
    stepFile: "BOS-S.step",
    leadTimeWeeks: 18,

    parameters: [
      {
        id: "antal_band",
        label: "Antal band per paket",
        type: "number",
        unit: "st",
        min: 2,
        max: 6,
        step: 1,
        defaultNumber: 2,
      },
    ],
    options: [
    ],
  },
  {
    id: "strofacksmagasin",
    sku: "MAG",
    name: "Ströfacksmagasin",
    category: "stickers",
    summary: "Magasin för truckströ. Fylls av truck eller pall. Placeras på vald sida.",
    aiDescription:
      "Magasinet som försörjer truckströläggaren med strö. Enligt katalogen anpassas magasinets storlek och placering efter tillgängligt utrymme, och det kan stå på båda sidor av rullbanan — det är den frågan kunden svarar på i konfiguratorn.\n" +
      "På den enkla truckströläggaren fylls magasinet manuellt av operatören under drift. På multi-varianten kör operatören i stället in en hel pall som vakuumlyftet tömmer.\n" +
      "Magasinet måste nås av truck eller operatör utan att produktionsflödet korsas. Hamnar det på fel sida utlöses regel R-204.\n" +
      "Detta är ett hjälpobjekt: det ingår inte i produktionskedjan utan placeras bredvid sin ankarmaskin.",
    aux: true,
    anchorFor: "tsl-enkel",
    catalogueNumber: "—",
    dimensionsVerified: false,

    footprint: { lengthMm: 5700, widthMm: 3000, heightMm: 2500 },
    ports: [],
    mirrorable: false,

    zones: [
      {
        type: "service",
        box: { x: -600, y: -600, l: 5700 + 1200, w: 3000 + 1200 },
        label: "Påfyllningsyta",
      },
    ],
    clearance: { frontMm: 1000, backMm: 1000, leftMm: 1000, rightMm: 1000 },

    capacity: {
      packagesPerHour: 0,
      packageLengthMm: [0, 0],
      packageWidthMm: [0, 0],
      packageHeightMm: [0, 0],
      maxWeightKg: 0,
    },
    utilities: { powerKw: 0.0, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 14 },
    stepFile: "MAG.step",
    leadTimeWeeks: 12,
    options: [
    ],
  },
  {
    id: "manoverpulpet",
    sku: "MP",
    name: "Manöverpulpet med elskåp",
    category: "control",
    summary: "Operatörens plats. Elskåp med Siemens PLC och HMI.",
    aiDescription:
      "Operatörens manöverplats med elskåp, Siemens PLC och HMI-panel. Flera maskiner i katalogen levereras med eget elskåp; den här posten representerar den samlade operatörsplatsen i layouten.\n" +
      "Pulpeten placeras på den sida kunden valt, vid linjens mest manuella station. Operatören behöver fri sikt mot ströläggning och utlastning, och pulpeten får aldrig hamna i truckgatan — då utlöses regel R-203.\n" +
      "Flera maskiner har modem för uppkoppling vid distanssupport; den anslutningen dras normalt till elskåpet här.\n" +
      "Detta är ett hjälpobjekt och ingår inte i produktionskedjan.",
    aux: true,
    catalogueNumber: "—",
    dimensionsVerified: false,

    footprint: { lengthMm: 3400, widthMm: 1700, heightMm: 2100 },
    ports: [],
    mirrorable: false,

    zones: [
      {
        type: "service",
        box: { x: -800, y: -800, l: 3400 + 1600, w: 1700 + 1600 },
        label: "Operatörsyta",
      },
    ],
    clearance: { frontMm: 800, backMm: 800, leftMm: 800, rightMm: 800 },

    capacity: {
      packagesPerHour: 0,
      packageLengthMm: [0, 0],
      packageWidthMm: [0, 0],
      packageHeightMm: [0, 0],
      maxWeightKg: 0,
    },
    utilities: { powerKw: 1.5, airNlPerMin: 0 },
    foundation: { pitDepthMm: 0, pointLoadKn: 6 },
    stepFile: "MP.step",
    leadTimeWeeks: 12,
    options: [
    ],
  },
];

/**
 * Ett maskinbibliotek är ett värde, inte en global konstant. Motorn, reglerna
 * och AI-verktygen tar emot det som argument, så att admin-vyn kan byta ut
 * innehållet utan att någon kod behöver känna till var datan kommer ifrån.
 */
export type MachineLibrary = {
  machines: Machine[];
  byId: Map<string, Machine>;
};

export function makeLibrary(machines: Machine[]): MachineLibrary {
  return { machines, byId: new Map(machines.map((m) => [m.id, m])) };
}

/** Inbyggt bibliotek. Används som utgångsläge och som standard i tester. */
export const BUILTIN_LIBRARY = makeLibrary(BUILTIN_MACHINES);

export function getMachine(
  id: string,
  library: MachineLibrary = BUILTIN_LIBRARY,
): Machine | undefined {
  return library.byId.get(id);
}

export const CATEGORY_LABEL: Record<MachineCategory, string> = {
  infeed: "Inmatning",
  stacking: "Paketläggning",
  stickers: "Ströläggning",
  transport: "Transport",
  processing: "Bearbetning",
  finishing: "Finish",
  outfeed: "Utlastning",
  control: "Styr",
};

/** Rimlig ordning i kedjan; används för att varna om linjen är felsorterad. */
export const CATEGORY_ORDER: MachineCategory[] = [
  "infeed",
  "transport",
  "stacking",
  "stickers",
  "processing",
  "finishing",
  "outfeed",
  "control",
];
