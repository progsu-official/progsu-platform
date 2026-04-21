import { z } from "zod";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB, decision reconciliation #1

export const createResumeUploadUrlSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/\.pdf$/i, "Must be a PDF file"),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_RESUME_BYTES, "File is larger than 10 MB"),
});

export const finalizeResumeUploadSchema = z.object({
  resumeId: z.string().uuid(),
});

export const deleteResumeSchema = z.object({
  resumeId: z.string().uuid(),
});

export type CreateResumeUploadUrlInput = z.infer<
  typeof createResumeUploadUrlSchema
>;
export type FinalizeResumeUploadInput = z.infer<
  typeof finalizeResumeUploadSchema
>;
export type DeleteResumeInput = z.infer<typeof deleteResumeSchema>;
