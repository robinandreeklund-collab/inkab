"use client";

import { useRef, useState } from "react";
import { Button } from "../ui";
import { Grid, Panel, TextField } from "./fields";
import type { LibraryAsset } from "@/lib/machineSchema";
import type { Machine } from "@/lib/types";

/** Bredd bilderna skalas ner till innan de lagras, px. */
const MAX_WIDTH = 1600;
/** Tak per bild efter komprimering, byte. */
const MAX_BYTES = 900_000;

/**
 * Bilder lagras som WebP i biblioteksdokumentet och serveras via
 * /api/library/asset/[id]. De skalas ner i webbläsaren före uppladdning så att
 * dokumentet inte växer okontrollerat.
 */
export function ImagePanel({
  machine,
  assets,
  onChange,
  onAssetsChange,
}: {
  machine: Machine;
  assets: LibraryAsset[];
  onChange: (machine: Machine) => void;
  onAssetsChange: (assets: LibraryAsset[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const images = machine.images ?? [];
  const machineAssets = images
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is LibraryAsset => !!a);

  const addFiles = async (files: FileList) => {
    setBusy(true);
    setError(null);
    const added: LibraryAsset[] = [];

    for (const file of Array.from(files).slice(0, 8 - images.length)) {
      try {
        const asset = await compress(file, machine.id);
        if (asset.data.length * 0.75 > MAX_BYTES) {
          setError(`${file.name} är för stor även efter komprimering.`);
          continue;
        }
        added.push(asset);
      } catch {
        setError(`Kunde inte läsa ${file.name}.`);
      }
    }

    if (added.length > 0) {
      onAssetsChange([...assets, ...added]);
      onChange({ ...machine, images: [...images, ...added.map((a) => a.id)] });
    }
    setBusy(false);
  };

  const remove = (assetId: string) => {
    onChange({ ...machine, images: images.filter((id) => id !== assetId) });
    onAssetsChange(assets.filter((a) => a.id !== assetId));
  };

  return (
    <Panel
      title="Bilder och katalog"
      description="Visas för kunden när maskinen är markerad. Max 8 bilder."
      action={
        <div className="flex gap-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button size="sm" disabled={busy || images.length >= 8} onClick={() => fileInput.current?.click()}>
            {busy ? "Bearbetar…" : "+ Bild"}
          </Button>
        </div>
      }
    >
      {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}

      {machineAssets.length > 0 ? (
        <div className="mb-3 grid grid-cols-4 gap-2">
          {machineAssets.map((asset) => (
            <div key={asset.id} className="border border-divider">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${asset.mime};base64,${asset.data}`}
                alt={asset.name}
                className="h-20 w-full object-cover"
              />
              <div className="flex items-center gap-1 border-t border-divider px-1 py-0.5">
                <span className="kicker truncate">{asset.name}</span>
                <button
                  onClick={() => remove(asset.id)}
                  className="ml-auto text-muted hover:text-danger"
                  aria-label="Ta bort bild"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-3 border border-dashed border-divider px-3 py-4 text-xs text-muted">
          Inga bilder. Bilderna skalas till {MAX_WIDTH} px bredd och sparas som WebP.
        </p>
      )}

      <div className="mb-3 border-t border-divider pt-3">
        <div className="kicker mb-1">3D-modell</div>
        <p className="mb-2 text-[11px] leading-relaxed text-muted">
          Tas fram med <code className="num">scripts/step-to-glb.mjs</code> ur maskinens
          STEP-fil. Modellen visas i vyn Modell. Utan modell ritas maskinen som sitt
          fotavtryck.
        </p>
        <Grid cols={2}>
          <TextField
            label="GLB"
            mono
            value={machine.model?.glb ?? ""}
            placeholder="/models/tsl-enkel.glb"
            onChange={(v) =>
              onChange({
                ...machine,
                model: v ? { glb: v, proxy: machine.model?.proxy } : undefined,
              })
            }
          />
          <TextField
            label="Proxy-GLB"
            mono
            hint="valfri"
            value={machine.model?.proxy ?? ""}
            placeholder="/models/tsl-enkel.proxy.glb"
            onChange={(v) =>
              onChange({
                ...machine,
                model: machine.model?.glb
                  ? { glb: machine.model.glb, proxy: v || undefined }
                  : machine.model,
              })
            }
          />
        </Grid>
      </div>

      <Grid cols={2}>
        <TextField
          label="Länk till produktsida"
          value={machine.productUrl ?? ""}
          placeholder="https://…"
          onChange={(v) => onChange({ ...machine, productUrl: v || undefined })}
        />
        <TextField
          label="Länk till datablad"
          value={machine.datasheetUrl ?? ""}
          placeholder="https://…"
          onChange={(v) => onChange({ ...machine, datasheetUrl: v || undefined })}
        />
      </Grid>
    </Panel>
  );
}

/** Skalar ner och komprimerar bilden i webbläsaren. */
async function compress(file: File, machineId: string): Promise<LibraryAsset> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Ingen canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/webp", 0.82);
  return {
    id: `${machineId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    machineId,
    name: file.name.slice(0, 160),
    mime: "image/webp",
    data: dataUrl.split(",")[1] ?? "",
  };
}
