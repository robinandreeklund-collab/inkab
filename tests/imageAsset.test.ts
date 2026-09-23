import { describe, expect, it } from "vitest";
import { base64OfDataUrl, byteSize, chooseImage, mimeOfDataUrl } from "@/lib/imageAsset";

/**
 * Produktbildernas kodning.
 *
 * `canvas.toDataURL("image/webp")` är en önskan. Enligt HTML-standarden ska en
 * webbläsare som inte kan formatet svara med PNG i stället — utan att säga
 * något. Koden tog webp för givet och märkte PNG-byte som webp: bilden vägrade
 * visas, eller föll på storleksgränsen eftersom en PNG är många gånger större.
 * Testerna håller fast vid att typen läses ur svaret.
 */

const dataUrl = (mime: string, bytes: number) =>
  `data:${mime};base64,${Buffer.alloc(bytes, 7).toString("base64")}`;

describe("mimeOfDataUrl", () => {
  it("läser typen ur huvudet", () => {
    expect(mimeOfDataUrl(dataUrl("image/webp", 10))).toBe("image/webp");
    expect(mimeOfDataUrl(dataUrl("image/png", 10))).toBe("image/png");
    expect(mimeOfDataUrl("data:,tomt")).toBe("");
    expect(mimeOfDataUrl("inte en data-uri")).toBe("");
  });
});

describe("byteSize", () => {
  it("räknar råstorleken bakom base64", () => {
    for (const bytes of [1, 2, 3, 100, 901]) {
      expect(byteSize(Buffer.alloc(bytes, 1).toString("base64"))).toBe(bytes);
    }
    expect(byteSize("")).toBe(0);
  });
});

describe("chooseImage", () => {
  it("tar webp när webbläsaren kan det", () => {
    const chosen = chooseImage([dataUrl("image/webp", 200), dataUrl("image/jpeg", 800)]);
    expect(chosen).toMatchObject({ mime: "image/webp", bytes: 200 });
  });

  it("tar jpeg när webp-förfrågan gav en png tillbaka", () => {
    // Så ser en webbläsare utan webp ut: samma canvas, png i stället.
    const chosen = chooseImage([dataUrl("image/png", 2_400_000), dataUrl("image/jpeg", 260_000)]);
    expect(chosen).toMatchObject({ mime: "image/jpeg", bytes: 260_000 });
  });

  it("märker aldrig bilden som något den inte är", () => {
    const chosen = chooseImage([dataUrl("image/png", 500)]);
    expect(chosen?.mime).toBe("image/png");
  });

  it("struntar i format biblioteket inte tar emot", () => {
    expect(chooseImage([dataUrl("image/gif", 10), dataUrl("image/jpeg", 900)])?.mime).toBe(
      "image/jpeg",
    );
    expect(chooseImage([dataUrl("image/gif", 10)])).toBeNull();
    expect(chooseImage(["skräp", "data:image/webp;base64,"])).toBeNull();
  });

  it("ger tillbaka base64 utan prefix", () => {
    const url = dataUrl("image/webp", 30);
    expect(chooseImage([url])?.data).toBe(base64OfDataUrl(url));
    expect(chooseImage([url])?.data.startsWith("data:")).toBe(false);
  });
});
