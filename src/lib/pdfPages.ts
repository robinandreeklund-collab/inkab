/**
 * Pdf till sidbilder, i webbläsaren.
 *
 * En pdf är inte en bild. Claude läser den som ett dokument, med text och allt,
 * men andra modeller tar bara emot bilder — och en kundritning som kommer som
 * pdf ska inte behöva laddas om som skärmdump för att kunna läsas.
 *
 * Renderingen görs här, av samma skäl som STEP-konverteringen: den är tung, den
 * är kundens fil, och webbservern har 512 MB att röra sig med.
 */

/** Fler sidor än så är inte en ritning utan en katalog. */
export const MAX_PDF_PAGES = 4;

export type PdfPage = { dataUrl: string; page: number; pages: number };

/**
 * Renderar sidorna till png.
 *
 * png och inte jpeg: en ritning är streck, och streck mår illa av jpeg — det
 * är måtten längs dem som ska gå att läsa.
 */
export async function pdfToImages(file: File, maxEdge = 1600): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  // Arbetaren ligger i public/, kopierad från paketet vid bygget.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const pages = Math.min(document.numPages, MAX_PDF_PAGES);
  const out: PdfPage[] = [];

  for (let number = 1; number <= pages; number++) {
    const page = await document.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const scale = maxEdge / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale: Math.min(scale, 4) });

    const canvas = document_createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Webbläsaren kunde inte rita upp pdf-sidan.");
    // Vit botten: en pdf har ingen, och utan den blir sidan svart.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;

    out.push({ dataUrl: canvas.toDataURL("image/png"), page: number, pages: document.numPages });
    page.cleanup();
  }

  await document.destroy();
  return out;
}

function document_createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
