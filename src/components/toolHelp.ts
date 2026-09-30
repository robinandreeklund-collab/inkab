import type { Tool } from "@/store/useConfigStore";

/**
 * Vad varje ritverktyg gör, på ett ställe. Samma text i verktygsraden,
 * sidopanelen, guiden och tipsraden som syns medan verktyget är valt — så att
 * ingen av dem säger något annat än de andra.
 */
export const TOOL_HELP: Record<Tool, { label: string; title: string; body: string; hint: string; shortcut: string }> = {
  select: {
    label: "Markera",
    title: "Markera och flytta",
    body: "Klicka på en maskin, port eller zon för att se och ändra den. Dra för att flytta. Dra i hallens kanter för att ändra ytan.",
    hint: "Klicka för att markera, dra för att flytta. Dra i hallens kant eller hörn för att ändra ytan.",
    shortcut: "V",
  },
  wall: {
    label: "Vägg",
    title: "Rita vägg",
    body: "Mellanväggar och innerväggar. Dra åt det håll väggen går — den blir rak av sig själv och fäster i väggarna intill. Hallens ytterväggar finns redan.",
    hint: "Dra från ena änden till den andra. Väggen rätas och fäster i väggarna intill.",
    shortcut: "W",
  },
  door: {
    label: "Port",
    title: "Rita port",
    body: "Där trucken kör in och ut. Dra längs en vägg eller hallens kant — porten sätts in i väggen och avståndet till närmaste vägg på båda sidor visas medan du drar.",
    hint: "Dra längs en vägg eller hallens kant. Avståndet till väggen på båda sidor visas medan du drar.",
    shortcut: "D",
  },
  truck: {
    label: "Truckzon",
    title: "Rita truckgata eller hämtzon",
    body: "Ytan trucken kör på eller hämtar paket från. Regelverket håller maskinerna borta från den och kontrollerar att den är bred nog.",
    hint: "Dra en rektangel där trucken kör eller hämtar paket.",
    shortcut: "T",
  },
  nogo: {
    label: "No-go",
    title: "Rita no-go-zon",
    body: "Ytor där inget får stå: pelare, trappor, elcentraler, befintlig utrustning. Hamnar en maskin där säger regelverket ifrån.",
    hint: "Dra en rektangel över ytan som ska hållas fri.",
    shortcut: "N",
  },
  measure: {
    label: "Mät",
    title: "Mät avstånd",
    body: "Dra mellan två punkter för att se avståndet. Mätningen sparas inte.",
    hint: "Dra mellan två punkter för att mäta.",
    shortcut: "M",
  },
};
