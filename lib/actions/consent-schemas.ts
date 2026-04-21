import { z } from "zod";

export const CONSENT_TYPES = [
  "privacy_policy",
  "terms_of_service",
  "age_confirmation",
  "recruiter_resume_sharing",
  "email_marketing",
  "sms_marketing",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

export const REQUIRED_CONSENT_TYPES: ConsentType[] = [
  "privacy_policy",
  "terms_of_service",
  "age_confirmation",
];

export const CONSENT_LABELS: Record<ConsentType, string> = {
  privacy_policy: "Privacy Policy",
  terms_of_service: "Terms of Service",
  age_confirmation: "I confirm I am 18 or older",
  recruiter_resume_sharing:
    "Share my profile and current resume with sponsors and recruiters Progsu works with",
  email_marketing: "Email me about Progsu events and opportunities",
  sms_marketing: "Text me about Progsu events and opportunities",
};

// Per-key validation: each known consent type is optional but, when present, must
// be a boolean. z.record treats keys as required by default, so we build an object
// schema with each field marked optional.
const acceptancesSchema = z
  .object(
    Object.fromEntries(
      CONSENT_TYPES.map((t) => [t, z.boolean().optional()])
    ) as Record<(typeof CONSENT_TYPES)[number], z.ZodOptional<z.ZodBoolean>>
  )
  .strict();

export const recordConsentsSchema = z
  .object({
    acceptances: acceptancesSchema,
  })
  .strict();

export type RecordConsentsInput = z.infer<typeof recordConsentsSchema>;
