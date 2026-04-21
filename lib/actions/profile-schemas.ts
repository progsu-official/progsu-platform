import { z } from "zod";

import { CLASS_STANDINGS, GRAD_TERMS, INTERESTED_ROLES } from "@/lib/enums/roles";

// Kept in a non-"use server" module so we can import types from client components.

const CurrentYear = new Date().getUTCFullYear();
const MaxGradYear = CurrentYear + 6;
const MinGradYear = CurrentYear - 1;

const urlOrEmpty = (host: RegExp | null) =>
  z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .refine(
      (v) =>
        v === null ||
        (/^https?:\/\//i.test(v) && (host === null || host.test(v))),
      "Enter a valid URL"
    );

export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    preferredName: z.string().trim().max(100).optional().nullable(),
    school: z.string().trim().min(1).max(150),
    major: z.string().trim().min(1).max(150),
    minor: z.string().trim().max(150).optional().nullable(),
    classStanding: z.enum(CLASS_STANDINGS),
    gradYear: z.coerce
      .number()
      .int()
      .min(MinGradYear, `Graduation year must be ${MinGradYear} or later`)
      .max(MaxGradYear, `Graduation year must be ${MaxGradYear} or earlier`),
    gradTerm: z.enum(GRAD_TERMS),
    interestedRoles: z
      .array(z.enum(INTERESTED_ROLES))
      .min(1, "Pick at least one role")
      .max(6, "Pick up to 6 roles")
      .transform((arr) => Array.from(new Set(arr))),
    linkedinUrl: urlOrEmpty(
      /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i
    ).optional(),
    githubUrl: urlOrEmpty(/^https?:\/\/([a-z0-9-]+\.)*github\.com\//i).optional(),
    portfolioUrl: urlOrEmpty(null).optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+?[0-9\-\(\) ]{7,20}$/, "Enter a valid phone number")
      .optional()
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
