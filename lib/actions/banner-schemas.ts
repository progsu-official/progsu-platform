import { z } from "zod";

export const MAX_BANNER_BYTES = 4 * 1024 * 1024; // 4 MB — matches bucket cap.

export const BANNER_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type BannerMimeType = (typeof BANNER_MIME_TYPES)[number];

export const createBannerUploadUrlSchema = z.object({
  mimeType: z.enum(BANNER_MIME_TYPES),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_BANNER_BYTES, "Banner must be 4 MB or smaller."),
});
export type CreateBannerUploadUrlInput = z.infer<
  typeof createBannerUploadUrlSchema
>;

export const finalizeBannerUploadSchema = z.object({
  path: z
    .string()
    .regex(
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/,
      "Unexpected upload path."
    ),
});
export type FinalizeBannerUploadInput = z.infer<
  typeof finalizeBannerUploadSchema
>;

export const MAX_NOTE_LENGTH = 80; // Matches the profiles.note check constraint.

export const setProfileNoteSchema = z.object({
  note: z
    .string()
    .trim()
    .max(MAX_NOTE_LENGTH, `Keep it to ${MAX_NOTE_LENGTH} characters or fewer.`)
    .refine((v) => !/[\r\n]/.test(v), "Notes are a single line.")
    .transform((v) => (v.length === 0 ? null : v))
    .nullable(),
});
export type SetProfileNoteInput = z.input<typeof setProfileNoteSchema>;
