/**
 * Bilagor till assistenten.
 *
 * Kunden laddar upp en ritning över lokalen eller en bild på ett tänkt flöde.
 * Filerna kommer som de ligger — en pdf från arkitekten, en mobilbild på en
 * skiss på ett bord, en skärmdump på tolv megapixel. Här görs de om till något
 * som går att skicka: bilder krymps till en storlek som räcker för att läsa
 * mått ur, pdf:er skickas som de är.
 *
 * Att krympa i webbläsaren är inte bara en artighet mot nätet. En bild som är
 * större än modellen ändå kan läsa kostar tid och pengar utan att ge ett enda
 * mått till.
 */

export type Attachment = {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf";
  /** Ren base64, utan data:-prefix. */
  data: string;
  /** Visningsbar kopia i gränssnittet. */
  previewUrl: string;
  bytes: number;
};

export const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
export const MAX_ATTACHMENTS = 4;
/** Längsta sida efter krympning. Räcker för att läsa måttsatta ritningar. */
export const MAX_EDGE_PX = 1600;
/** Tak för en pdf; den kan inte krympas här. */
export const MAX_PDF_BYTES = 6_000_000;

const TYPES: Attachment["mediaType"][] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
];

export function isAccepted(type: string): type is Attachment["mediaType"] {
  return (TYPES as string[]).includes(type);
}

/** base64-delen ur en data-URL. */
export function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Filen gick inte att läsa."));
    reader.readAsDataURL(file);
  });

/**
 * Gör en fil till en bilaga. Kastar med ett meddelande som går att visa för
 * kunden — det är enda felhanteringen som betyder något här.
 */
export async function toAttachment(file: File): Promise<Attachment> {
  if (!isAccepted(file.type)) {
    throw new Error(`${file.name}: bara bilder (png, jpg, webp, gif) och pdf går att läsa.`);
  }

  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(
        `${file.name} är ${Math.round(file.size / 1e6)} MB. Skicka en skärmbild av ` +
          `ritningen i stället, eller en mindre pdf (max ${MAX_PDF_BYTES / 1e6} MB).`,
      );
    }
    const dataUrl = await readAsDataUrl(file);
    return {
      name: file.name,
      mediaType: "application/pdf",
      data: base64Of(dataUrl),
      previewUrl: "",
      bytes: file.size,
    };
  }

  const original = await readAsDataUrl(file);
  const shrunk = await shrink(original, file.type);
  return {
    name: file.name,
    mediaType: shrunk.mediaType,
    data: base64Of(shrunk.dataUrl),
    previewUrl: shrunk.dataUrl,
    bytes: Math.round((shrunk.dataUrl.length - shrunk.dataUrl.indexOf(",") - 1) * 0.75),
  };
}

/**
 * Skalar ned en bild till MAX_EDGE_PX.
 *
 * Ritningar är streck, och streck mår illa av jpeg. Därför behåller png sitt
 * format så länge det inte blir orimligt stort; foton och skärmbilder blir
 * jpeg, som de redan brukar vara.
 */
async function shrink(
  dataUrl: string,
  type: string,
): Promise<{ dataUrl: string; mediaType: Attachment["mediaType"] }> {
  const image = await loadImage(dataUrl);
  const longest = Math.max(image.width, image.height);
  const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1;

  if (scale === 1 && dataUrl.length < 2_000_000) {
    return { dataUrl, mediaType: isAccepted(type) ? type : "image/png" };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl, mediaType: isAccepted(type) ? type : "image/png" };
  // Vit botten: en png med genomskinlig bakgrund blir annars svart som jpeg.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (type === "image/png" || type === "image/gif") {
    const png = canvas.toDataURL("image/png");
    if (png.length < 4_000_000) return { dataUrl: png, mediaType: "image/png" };
  }
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.9), mediaType: "image/jpeg" };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Bilden gick inte att öppna."));
    image.src = src;
  });
}
