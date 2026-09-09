"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_ATTACHMENTS, toAttachments, type Attachment } from "@/lib/attachments";

/**
 * Bilagorna kunden valt, i det skick mottagaren kan läsa dem.
 *
 * Vad assistenten klarar avgörs på servern och hämtas innan filerna görs i
 * ordning: kan den valda modellen inte läsa pdf görs ritningen om till
 * sidbilder här, i webbläsaren, i stället för att avvisas efteråt med ett fel
 * kunden inte kan göra något åt.
 */
export function useAttachments() {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** null tills servern svarat; då vet vi inte och skickar pdf som pdf. */
  const [acceptsPdf, setAcceptsPdf] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/ai/capabilities")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAcceptsPdf(data?.configured ? !!data.acceptsPdf : null))
      .catch(() => setAcceptsPdf(null));
  }, []);

  const add = useCallback(
    async (chosen: FileList | null) => {
      if (!chosen?.length) return;
      setReading(true);
      setProblem(null);
      const added: Attachment[] = [];
      const problems: string[] = [];

      for (const file of Array.from(chosen).slice(0, MAX_ATTACHMENTS)) {
        try {
          added.push(...(await toAttachments(file, { acceptsPdf: acceptsPdf ?? true })));
        } catch (error) {
          problems.push(
            error instanceof Error ? error.message : `${file.name} gick inte att läsa.`,
          );
        }
      }

      let dropped = 0;
      setFiles((current) => {
        const next = [...current, ...added];
        dropped = Math.max(0, next.length - MAX_ATTACHMENTS);
        return next.slice(0, MAX_ATTACHMENTS);
      });
      if (dropped > 0) {
        problems.push(
          `Bara ${MAX_ATTACHMENTS} bilagor åt gången; ${dropped} kom inte med. ` +
            "En flersidig pdf blir en bilaga per sida.",
        );
      }
      if (problems.length) setProblem(problems.join(" · "));
      setReading(false);
    },
    [acceptsPdf],
  );

  const removeAt = useCallback((index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => setFiles([]), []);

  return { files, add, removeAt, clear, reading, problem, setProblem, acceptsPdf };
}
