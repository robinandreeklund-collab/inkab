import type { Tool } from "@/store/useConfigStore";

type T = (key: string, vars?: Record<string, string | number>) => string;

const SHORTCUT: Record<Tool, string> = {
  select: "V",
  wall: "W",
  door: "D",
  truck: "T",
  nogo: "N",
  measure: "M",
};

/**
 * Vad varje ritverktyg gör, på ett ställe. Samma text i verktygsraden,
 * sidopanelen, guiden och tipsraden som syns medan verktyget är valt — så att
 * ingen av dem säger något annat än de andra.
 */
export function toolHelp(t: T, tool: Tool) {
  return {
    label: t(`tool.${tool}`),
    title: t(`tip.${tool}.title`),
    body: t(`tip.${tool}.body`),
    hint: t(`tip.${tool}.hint`),
    shortcut: SHORTCUT[tool],
  };
}
