import { z } from "zod";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB — matches bucket cap.

export const AVATAR_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

export const createAvatarUploadUrlSchema = z.object({
  mimeType: z.enum(AVATAR_MIME_TYPES),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_AVATAR_BYTES, "Photo must be 2 MB or smaller."),
});
export type CreateAvatarUploadUrlInput = z.infer<
  typeof createAvatarUploadUrlSchema
>;

export const finalizeAvatarUploadSchema = z.object({
  path: z
    .string()
    .regex(
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/,
      "Unexpected upload path."
    ),
});
export type FinalizeAvatarUploadInput = z.infer<
  typeof finalizeAvatarUploadSchema
>;
