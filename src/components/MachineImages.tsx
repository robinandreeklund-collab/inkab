"use client";

import { useState } from "react";
import type { Machine } from "@/lib/types";

/** Bilder och kataloglänkar som admin lagt in på maskinen. */
export function MachineImages({ machine }: { machine: Machine }) {
  const [open, setOpen] = useState<string | null>(null);
  const images = machine.images ?? [];
  const hasLinks = !!machine.productUrl || !!machine.datasheetUrl;

  if (images.length === 0 && !hasLinks) return null;

  return (
    <div className="mt-4">
      <div className="kicker mb-2">Produktinformation</div>

      {images.length > 0 ? (
        <div className="mb-2 grid grid-cols-3 gap-1">
          {images.map((assetId) => (
            <button
              key={assetId}
              onClick={() => setOpen(assetId)}
              className="border border-divider bg-paper hover:border-accent"
            >
              {/* Bilderna ligger i biblioteksdokumentet och serveras per id. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/library/asset/${assetId}`}
                alt={machine.name}
                className="h-16 w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}

      {hasLinks ? (
        <div className="flex flex-wrap gap-2">
          {machine.productUrl ? (
            <a
              href={machine.productUrl}
              target="_blank"
              rel="noreferrer"
              className="kicker border border-divider px-2 py-1 hover:border-accent"
            >
              Produktsida ↗
            </a>
          ) : null}
          {machine.datasheetUrl ? (
            <a
              href={machine.datasheetUrl}
              target="_blank"
              rel="noreferrer"
              className="kicker border border-divider px-2 py-1 hover:border-accent"
            >
              Datablad ↗
            </a>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6"
          onClick={() => setOpen(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/library/asset/${open}`}
            alt={machine.name}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
