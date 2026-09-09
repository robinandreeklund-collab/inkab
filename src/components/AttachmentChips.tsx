"use client";

import type { Attachment } from "@/lib/attachments";

/** Bilagorna som brickor: miniatyr, namn, storlek och ett kryss. */
export function AttachmentChips({
  files,
  onRemove,
}: {
  files: Attachment[];
  onRemove: (index: number) => void;
}) {
  if (files.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {files.map((file, index) => (
        <span
          key={`${file.name}-${index}`}
          className="flex items-center gap-2 border border-divider px-2 py-1 text-[11px]"
        >
          {file.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.previewUrl} alt="" className="h-8 w-8 object-cover" />
          ) : (
            <span className="kicker text-muted">PDF</span>
          )}
          <span className="max-w-[200px] truncate">{file.name}</span>
          <span className="num text-muted">{Math.max(1, Math.round(file.bytes / 1000))} kB</span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Ta bort ${file.name}`}
            className="px-1 text-muted hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
