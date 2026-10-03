import { z } from "zod";

import { isValidUsPhone, US_PHONE_ERROR } from "@/lib/phone";

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

// Onboarding-only minimum bar (docs/14-low-friction-signup §2). Used by the
// /onboarding/profile form. Settings page keeps using the full
// updateProfileSchema below. Verify-email auto-populates school if the user
// verifies first; this form also exposes a school picker so users who haven't
// verified yet can still finish onboarding.
// Affiliation is self-reported (never proof of GSU enrollment — that is
// is_verified_gsu(), from a verified student email). School and major are
// required only for students; nonstudents may leave both empty. Mirrors
// lib/auth/onboarding.ts + is_fully_onboarded() (20261003100000).
export const SELF_REPORTED_AFFILIATIONS = [
  "gsu_student",
  "other_student",
  "nonstudent",
] as const;

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const minimalSignupProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    preferredName: optionalTrimmed(100),
    affiliation: z.enum(SELF_REPORTED_AFFILIATIONS, {
      message: "Tell us how you're connected to Progsu",
    }),
    institutionName: optionalTrimmed(150),
    school: optionalTrimmed(150),
    phoneNumber: z
      .string()
      .trim()
      .min(1, "Phone number is required")
      .refine(isValidUsPhone, US_PHONE_ERROR),
    // Slug validation is done at call time against the majors table so admins
    // can add majors without a redeploy. Zod just checks the shape here.
    major: optionalTrimmed(100),
    majorOtherText: optionalTrimmed(100),
    minor: optionalTrimmed(150),
  })
  .strict()
  .refine((v) => v.affiliation === "nonstudent" || Boolean(v.school), {
    message: "Pick your school",
    path: ["school"],
  })
  .refine((v) => v.affiliation === "nonstudent" || Boolean(v.major), {
    message: "Pick a major from the list",
    path: ["major"],
  })
  .refine(
    (v) => v.major !== "other" || (v.majorOtherText && v.majorOtherText.trim().length > 0),
    { message: "Tell us your major", path: ["majorOtherText"] }
  );

export type MinimalSignupProfileInput = z.infer<typeof minimalSignupProfileSchema>;

// Second onboarding step (docs/14-low-friction-signup follow-up, 2026-08-23):
// grad info, roles, and links used to be deferred entirely to the dashboard
// profile-completion ring. Now collected up front on their own step
// (/onboarding/links) right after the minimal-signup step, as its own
// partial write, same shape the full updateProfileSchema below uses for
// these fields, just without the identity fields that step doesn't touch.
export const onboardingLinksSchema = z
  .object({
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
    bio: z
      .string()
      .trim()
      .max(220, "Keep it to 220 characters")
      .refine((v) => !/[\r\n]/.test(v), "One line only")
      .nullable()
      .optional(),
  })
  .strict();

export type OnboardingLinksInput = z.infer<typeof onboardingLinksSchema>;

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
    bio: z
      .string()
      .trim()
      .max(220, "Keep it to 220 characters")
      .refine((v) => !/[\r\n]/.test(v), "One line only")
      .nullable()
      .optional(),
    phoneNumber: z
      .string()
      .trim()
      .min(1, "Phone number is required")
      .refine(isValidUsPhone, US_PHONE_ERROR),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
