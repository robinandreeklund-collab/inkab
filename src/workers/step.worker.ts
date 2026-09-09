import { convertStep, type ConvertStage } from "@/lib/cad/stepConvert";

/**
 * Konverteringen körs här, i konstruktörens egen webbläsare.
 *
 * Inte i webbservern: en tessellering av en tung sammanställning tar
 * hundratals megabyte, och en webbinstans som får slut på minne dör — den
 * kastar inget fel som går att fånga, den försvinner, och svaret blir 502 utan
 * innehåll. En laptop har minnet. Servern får bara den färdiga GLB:n, några
 * hundra kilobyte, och STEP-filen behöver aldrig laddas upp alls.
 *
 * En worker och inte huvudtråden: annars fryser gränssnittet i minuter.
 */

export type WorkerRequest = {
  step: ArrayBuffer;
  options: {
    toleranceMm: number;
    angularDeflection: number;
    minPartMm: number;
    ratio: number;
    up: "z" | "y";
    proxy: boolean;
  };
};

export type WorkerResponse =
  | { kind: "progress"; stage: ConvertStage }
  | {
      kind: "done";
      glb: ArrayBuffer;
      proxy: ArrayBuffer | null;
      footprint: { lengthMm: number; widthMm: number; heightMm: number };
      ports: unknown;
      warnings: string[];
      stats: unknown;
    }
  | { kind: "error"; message: string };

/*
 * tsconfig drar in DOM-typerna, så `self` skrivs som ett fönster. Inne i en
 * worker är det en DedicatedWorkerGlobalScope, och bara den kan flytta
 * buffertar i stället för att kopiera dem.
 */
const scope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const result = await convertStep(new Uint8Array(event.data.step), {
      ...event.data.options,
      wasmUrl: "/occt/occt-import-js.wasm",
      onProgress: (stage) => post({ kind: "progress", stage }),
    });

    // Buffertarna flyttas i stället för att kopieras — en GLB kan vara stor,
    // och en kopia till skulle vara ren förlust.
    const glb = toArrayBuffer(result.glb);
    const proxy = result.proxy ? toArrayBuffer(result.proxy) : null;
    post(
      {
        kind: "done",
        glb,
        proxy,
        footprint: result.footprint,
        ports: result.ports,
        warnings: result.warnings,
        stats: result.stats,
      },
      proxy ? [glb, proxy] : [glb],
    );
  } catch (error) {
    post({
      kind: "error",
      message: error instanceof Error ? error.message : "Okänt fel i konverteringen.",
    });
  }
};

/** Uint8Array kan vara en vy över en större buffert; skicka bara sin del. */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}
