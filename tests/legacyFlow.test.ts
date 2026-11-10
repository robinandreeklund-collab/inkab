import { describe, expect, it } from "vitest";
import { configurationSchema } from "@/lib/schema";
import { decodeConfig } from "@/lib/share";
import { computeLayout } from "@/lib/layout";
import { defaultConfig } from "@/lib/templates";

/**
 * Flödespanelen är borttagen, men länkarna finns kvar.
 *
 * En delningslänk bär hela konfigurationen som den såg ut när den gjordes,
 * `flow` och allt. Hade schemat underkänt den nyckeln hade varje länk som
 * skickats ut före borttagningen slutat öppna — och ingen hade sett det
 * förrän en kund klickade.
 */

/** En riktig länk, gjord medan flödet fanns kvar. */
const GAMMAL_LANK =
  "z.H4sIAAAAAAAACrWW227jNhCGXyXgtQiI1NG627YLbNHDBtgCvVjkgpZoiRFFKiQtRwn8Nu" +
  "0r7AvkxQpRouVDHHsX6ZUhcsT_0z8z9DyDjirNpAAZ8kCr5D3NzZ-koSADv9BG3iDggYpwDr" +
  "JnwKkoTfVHA7LY933fAxtWjM_B-JxzStQnysrKuKitB1ZcbobXjVrn9S3L63X7hRWDAqcrAz" +
  "ygDVHmVjJhhrBHkGF7Wg8yhHDkb7eWrFjndr8leU1K-vsOJgqH6Gn5b4vExLCRnqyTx2EdoW" +
  "jemHER2o-3y7-VIEP2GENUSc3tuKlvqfok12rY3HqAM0FB9vUZMKENETn9tQAZaIiumYAohc" +
  "2GVI94SeECeKAhecXEUchgAuU0N7T43BomhQbZ1zsPtFJPloSLJBo9iQdLPKCkIWZMXOpvvb" +
  "fF14ZC8uPiQeISMqX0bfGaFve0JoJwWMl7TUQNNSs6pgcY5oc1gssjmLOvXAGHdtUSHtMtzs" +
  "AZRYRupTJSjUzqAcH8Naa9yHMoHVGMCGPf6Wji9-D1xEXX0h36MPChatHB4qJn31NG6XEZvU" +
  "Kj1pwviSAjg64XkB4xuIirvNELEh94E6SHqbsA0Pc9XL0rAI6cHdcA4LzpYfmuAGixcyC9Au" +
  "C-W8PqXQHinQGv69NmSTgnJV0bTsqSKDqSPPQPkB2RnMZeLkjsYwcwoJwCnOkI_LRaw_t36I" +
  "idATg67gicnLZES2pqeL8ycEW0sShBWjWwPkI5jLuMkUSuDhaRfxnjjCvBIzKQv4MrQfw998" +
  "Srd2pYPHIo_pc7daa75k5tiJAdVe2at3TMWJJ2MZQn_4d7YZcdQpHLmE3Y9s4DhSIbMQ4Cw4" +
  "GFHJ2oNk0QAg_UTLhl4AExDlm3UpmbD8CzlzN2nwXthMJBltqVjZ2wPFC5Dz5RUJF6U-GnUS" +
  "HwTxSSNxXszGY9iwXZzBJPUgzNbX-mqFnxr-HxSQo7PB62mPWMjyJWNfQn2VlTtlQRV0VxXy" +
  "fnZF3grPzZrrx8U7rlxGgHkMzzpANAO2djewEdENjMK5YTPpZLVOhzDHPoTPGR51QYRfhO39" +
  "1xoyh37b4BGT5V11R1LB_v2URszro-xc26X8aF3hAnjGOnjJ1y5JQROrVeyFKOun3vn9Mdgv" +
  "ZE25d_lCLFzZ7sPC9i53cyy55-satjtiwC_WYd_zxV1O78ReocdRV1UMdDV7KGCj21sBNkza" +
  "indAkx8MBKycY1Ng7c4XGAh9vFyN2oidPDLSHNwEY6bV7-FcUNAvNHTRp53IUwOtQIwzCZDg" +
  "rCQ4kE4WkHp3sKH5wCBtu77X-jMET1tw0AAA";

describe("en delningslänk från före borttagningen", () => {
  it("öppnar fortfarande", async () => {
    const result = await decodeConfig(GAMMAL_LANK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.line.length).toBeGreaterThan(0);
    // Och den går att räkna på, inte bara att läsa in.
    expect(() => computeLayout(result.config)).not.toThrow();
  });

  it("flödet följer inte med in", async () => {
    const result = await decodeConfig(GAMMAL_LANK);
    expect(result.ok && "flow" in result.config).toBe(false);
  });

  it("schemat underkänner inte heller ett autosparat utkast med flöde", () => {
    const legacy = {
      ...(JSON.parse(JSON.stringify(defaultConfig())) as object),
      flow: {
        truckPickupSide: "left",
        startPoint: { x: 2000, y: 9000 },
        startComment: "paketen kommer från sågen",
        markers: [{ id: "m1", role: "end", pos: { x: 1, y: 2 }, comment: "x" }],
      },
    };
    const parsed = configurationSchema.safeParse(legacy);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.success && "flow" in parsed.data).toBe(false);
  });
});
