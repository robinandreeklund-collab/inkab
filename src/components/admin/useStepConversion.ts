"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkerRequest, WorkerResponse } from "@/workers/step.worker";
import type { Port } from "@/lib/types";

/**
 * STEP → GLB, i den här webbläsaren.
 *
 * Konverteringen körs i en web worker på den här datorn. STEP-filen laddas
 * aldrig upp — bara den färdiga GLB:n, några hundra kilobyte. Skälet är
 * hårt: tesselleringen tar hundratals megabyte, och en webbinstans som får
 * slut på minne dör utan att kunna svara. Laptopen har minnet.
 *
 * Utbruten som hook eftersom både basmaskinen och varje utförande laddar upp
 * sin egen fil, och två kopior av det här skulle glida isär.
 */

export type ConversionStats = {
  stepBytes: number;
  glbBytes: number;
  proxyBytes: number | null;
  partsIn: number;
  partsKept: number;
  trianglesIn: number;
  toleranceMm: number;
  minPartMm: number;
  seconds: number;
};

export type ConversionResult = {
  model: { glb: string; proxy?: string };
  footprint: { lengthMm: number; widthMm: number; heightMm: number };
  ports: Port[];
  warnings: string[];
  notes: string[];
  persisted: boolean;
  stats: ConversionStats;
};

export type ConversionOptions = {
  toleranceMm: number;
  minPartMm: number;
  proxy: boolean;
};

export const STAGE_TEXT: Record<string, string> = {
  laddar: "Startar OpenCascade",
  tessellerar: "Tessellerar geometrin",
  rensar: "Utelämnar smådelar",
  bygger: "Bygger modellen",
  förenklar: "Förenklar proxyn",
  komprimerar: "Komprimerar",
  "laddar upp": "Sparar modellen",
};

export function useStepConversion() {
  const [stage, setStage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);

  const busy = stage !== null;

  // Tesselleringen kan ta minuter på en stor sammanställning. Utan en klocka
  // ser det ut som att det har hängt sig.
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => () => worker.current?.terminate(), []);

  /**
   * Konverterar och lagrar. Returnerar resultatet, eller null när något gick
   * fel — felet står då i `error`.
   */
  const convert = (
    file: File,
    machineId: string,
    options: ConversionOptions,
  ): Promise<ConversionResult | null> =>
    new Promise(async (resolve) => {
      setError(null);
      setStage("laddar");

      let instance: Worker;
      try {
        instance = new Worker(new URL("../../workers/step.worker.ts", import.meta.url));
      } catch {
        setStage(null);
        setError("Webbläsaren kunde inte starta konverteringen. Prova en nyare webbläsare.");
        resolve(null);
        return;
      }
      worker.current = instance;

      const step = await file.arrayBuffer();
      const started = Date.now();

      const fail = (message: string) => {
        setStage(null);
        instance.terminate();
        setError(message);
        resolve(null);
      };

      instance.onerror = (event) =>
        // Slut på minne i webbläsaren visar sig här. Storleken är oftast svaret.
        fail(
          `Konverteringen avbröts (${event.message || "okänt fel"}). Är filen mycket stor: ` +
            "höj toleransen och gränsen för smådelar, eller kör den med skriptet.",
        );

      instance.onmessage = async (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;

        if (message.kind === "progress") {
          setStage(message.stage);
          return;
        }
        if (message.kind === "error") {
          fail(message.message);
          return;
        }

        instance.terminate();
        setStage("laddar upp");

        const form = new FormData();
        form.set("machineId", machineId);
        form.set("sourceName", file.name.slice(0, 160));
        form.set("glb", new Blob([message.glb], { type: "model/gltf-binary" }), `${machineId}.glb`);
        // En proxy som inte är märkbart mindre är bara en fil till att ladda ner.
        if (message.proxy && message.proxy.byteLength < message.glb.byteLength * 0.6) {
          form.set(
            "proxy",
            new Blob([message.proxy], { type: "model/gltf-binary" }),
            `${machineId}.proxy.glb`,
          );
        }

        try {
          const response = await fetch("/api/admin/model", { method: "POST", body: form });
          const body = await response.json().catch(() => null);
          if (!response.ok || !body?.ok) {
            fail(body?.error ?? `Servern svarade ${response.status}.`);
            return;
          }

          setStage(null);
          resolve({
            model: body.model,
            footprint: message.footprint,
            ports: message.ports as Port[],
            warnings: message.warnings,
            notes: body.notes ?? [],
            persisted: body.persisted,
            stats: {
              ...(message.stats as ConversionStats),
              seconds: Math.round((Date.now() - started) / 100) / 10,
            },
          });
        } catch {
          fail("Modellen konverterades men kunde inte sparas. Nätverket svarade inte.");
        }
      };

      instance.postMessage(
        {
          step,
          options: {
            toleranceMm: options.toleranceMm,
            angularDeflection: 0.5,
            minPartMm: options.minPartMm,
            ratio: 1,
            up: "z",
            proxy: options.proxy,
          },
        } satisfies WorkerRequest,
        [step],
      );
    });

  return { convert, stage, elapsed, busy, error, setError };
}
