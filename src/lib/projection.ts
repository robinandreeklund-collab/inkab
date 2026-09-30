import type { Box } from "./types";

/** Utsnittet med marginal runt om, i samma enhet som boxen. */
export function padBox(box: Box, padding: number): Box {
  return {
    x: box.x - padding,
    y: box.y - padding,
    l: box.l + padding * 2,
    w: box.w + padding * 2,
  };
}
