import { z } from "zod";

/**
 * Bifogade filer, som servern ser dem.
 *
 * Klienten krymper bilder innan de skickas, men taket måste ligga här också —
 * servern är den enda part som inte går att lura.
 */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_ATTACHMENTS = 4;
/** Base64 är ~4/3 av filen. 8 MB kodat ≈ 6 MB fil, per bilaga. */
export const MAX_ATTACHMENT_CHARS = 8_000_000;
export const MAX_TOTAL_CHARS = 20_000_000;

export const attachmentSchema = z.object({
  name: z.string().max(200).default("bilaga"),
  mediaType: z.enum([...IMAGE_TYPES, "application/pdf"]),
  /** Ren base64, utan data:-prefix. */
  data: z.string().min(1).max(MAX_ATTACHMENT_CHARS),
});

export type ValidatedAttachment = z.infer<typeof attachmentSchema>;
