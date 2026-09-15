"use client";

import { useRef, useState } from "react";
import { Button } from "../ui";
import { Grid, Panel, TextField } from "./fields";
import { byteSize, chooseImage, imageSrc } from "@/lib/imageAsset";
import type { LibraryAsset } from "@/lib/machineSchema";
import type { Machine } from "@/lib/types";

/** Bredd bilderna skalas ner till innan de lagras, px. */
const MAX_WIDTH = 1600;
/** Tak per bild efter komprimering, byte. */
const MAX_BYTES = 900_000;

/**
 * Bilder lagras i biblioteksdokumentet och serveras via
 * /api/library/asset/[id]. De skalas ner och komprimeras i webbläsaren före
 * uppladdning så att dokumentet inte växer okontrollerat — normalt till WebP,
 * men formatet är webbläsarens beslut och läses ur svaret. Se lib/imageAsset.
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
  const [note, setNote] = useState<string | null>(null);

  const images = machine.images ?? [];

  /*
   * En bildhänvisning är antingen ett id på en bild i dokumentet eller en
   * sökväg till en fil i repot — demo-paketet gör det ena till det andra.
   * Panelen måste visa båda, annars ser en committad bild ut som ingen bild
   * alls och någon laddar upp den en gång till.
   */
  const shown = images.map((entry) => {
    const asset = assets.find((a) => a.id === entry);
    return {
      entry,
      name: asset?.name ?? entry.split("/").pop() ?? entry,
      src: asset ? `data:${asset.mime};base64,${asset.data}` : imageSrc(entry),
      inRepo: !asset && entry.startsWith("/"),
      missing: !asset && !entry.startsWith("/"),
    };
  });

  const addFiles = async (files: FileList) => {
    setBusy(true);
    setError(null);
    setNote(null);

    const added: LibraryAsset[] = [];
    // Det som inte kom med måste synas. Förr skrev varje ny fil över förra
    // filens felrad, och den sista tystnaden såg ut som att allt gick bra.
    const skipped: string[] = [];
    const picked = Array.from(files);
    const room = picked.slice(0, 8 - images.length);
    if (picked.length > room.length) {
      skipped.push(`${picked.length - room.length} bild(er) över taket på 8`);
    }

    for (const file of room) {
      try {
        const asset = await compress(file, machine.id);
        const bytes = byteSize(asset.data);
        if (bytes > MAX_BYTES) {
          skipped.push(
            `${file.name} (${Math.round(bytes / 1024)} kB efter komprimering, taket är ` +
              `${Math.round(MAX_BYTES / 1024)} kB)`,
          );
          continue;
        }
        added.push(asset);
      } catch {
        skipped.push(`${file.name} (gick inte att läsa)`);
      }
    }

    if (added.length > 0) {
      onAssetsChange([...assets, ...added]);
      onChange({ ...machine, images: [...images, ...added.map((a) => a.id)] });
      setNote(
        `${added.length} ${added.length === 1 ? "bild" : "bilder"} tillagd${added.length === 1 ? "" : "a"}. ` +
          "Spara för att lägga dem i biblioteket.",
      );
    }
    if (skipped.length > 0) {
      setError(`Utelämnat: ${skipped.join("; ")}. Beskär eller minska bilden och försök igen.`);
    }
    setBusy(false);
  };

  const remove = (entry: string) => {
    onChange({ ...machine, images: images.filter((id) => id !== entry) });
    // En bild som ligger som fil i repot har inget att städa i dokumentet.
    onAssetsChange(assets.filter((a) => a.id !== entry));
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
      {error ? <p className="mb-2 border border-danger px-2 py-1 text-xs text-danger">{error}</p> : null}
      {note ? <p className="mb-2 border border-accent px-2 py-1 text-xs text-accent">{note}</p> : null}

      {shown.length > 0 ? (
        <div className="mb-3 grid grid-cols-4 gap-2">
          {shown.map((image) => (
            <div key={image.entry} className="border border-divider">
              {image.missing ? (
                <div className="flex h-20 items-center justify-center bg-paper px-1 text-center text-[10px] text-warn">
                  Bilden finns inte kvar på servern
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.src} alt={image.name} className="h-20 w-full object-cover" />
              )}
              <div className="flex items-center gap-1 border-t border-divider px-1 py-0.5">
                <span className="kicker truncate" title={image.entry}>
                  {image.inRepo ? `${image.name} (i repot)` : image.name}
                </span>
                <button
                  onClick={() => remove(image.entry)}
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
          Inga bilder. Bilderna skalas till {MAX_WIDTH} px bredd och komprimeras innan de
          sparas, max {Math.round(MAX_BYTES / 1024)} kB styck.
        </p>
      )}

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

  /*
   * Två kandidater, och den minsta vinner. En webbläsare som inte kan webp
   * ger en PNG tillbaka utan att säga något — då är JPEG-kandidaten den som
   * håller bilden under taket. Typen läses ur svaret, aldrig ur önskemålet.
   */
  const encoded = chooseImage([
    canvas.toDataURL("image/webp", 0.82),
    canvas.toDataURL("image/jpeg", 0.82),
  ]);
  if (!encoded) throw new Error("Webbläsaren gav inget användbart bildformat.");

  return {
    id: `${machineId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    machineId,
    name: file.name.slice(0, 160),
    mime: encoded.mime,
    data: encoded.data,
  };
}
