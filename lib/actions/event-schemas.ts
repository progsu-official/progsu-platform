import { z } from "zod";

import { isValidUsPhone, US_PHONE_ERROR } from "@/lib/phone";

// Kept in a non-"use server" module so we can import types/schemas from client
// components without pulling in server-only action code.

// Slug: lowercase alphanumerics + dashes, cannot start/end with dash, 3-64 chars.
// Matches the DB check constraint on events.slug.
const slugSchema = z
  .string()
  .trim()
  .min(3, "Slug must be at least 3 characters")
  .max(64, "Slug must be 64 characters or fewer")
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    "Lowercase letters, numbers, and dashes only; cannot start or end with a dash"
  );

export const EVENT_VISIBILITIES = ["members", "private_invite"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

// datetime-local fields come in as either naive "YYYY-MM-DDTHH:mm" or full ISO.
// We accept both and normalize to an ISO string before sending to Postgres.
const datetimeInputSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .transform((v, ctx) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid date/time",
      });
      return z.NEVER;
    }
    return d.toISOString();
  });

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v == null || v.length === 0 ? null : v))
  .refine(
    (v) => v === null || /^https?:\/\//i.test(v),
    "Enter a valid URL starting with http:// or https://"
  );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v == null || v.length === 0 ? null : v));

const hostSchema = z
  .object({
    display_name: z.string().trim().min(1, "Host name required").max(200),
    profile_id: z
      .string()
      .trim()
      .uuid()
      .optional()
      .nullable()
      .transform((v) => (v == null || v.length === 0 ? null : v)),
  })
  .strict();

export type EventHostInput = z.infer<typeof hostSchema>;

// Shared field object used by both create and update (patch) schemas.
const eventBaseShape = {
  slug: slugSchema,
  title: z.string().trim().min(1, "Title required").max(200),
  description_md: z
    .string()
    .trim()
    .max(20000)
    .optional()
    .nullable()
    .transform((v) => (v == null || v.length === 0 ? null : v)),
  visibility: z.enum(EVENT_VISIBILITIES),
  starts_at: datetimeInputSchema,
  ends_at: datetimeInputSchema,
  location_text: optionalText(500),
  location_url: optionalUrl,
  capacity: z
    .union([
      z.string().trim(),
      z.number(),
    ])
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    })
    .refine(
      (v) => v === null || (Number.isInteger(v) && v >= 0),
      "Capacity must be zero or a positive integer"
    ),
  waitlist_enabled: z.coerce.boolean().optional().default(false),
  is_sensitive: z.coerce.boolean().optional().default(false),
  send_rsvp_email: z.coerce.boolean().optional().default(true),
  send_reminder_email: z.coerce.boolean().optional().default(true),
  cover_image_path: optionalText(500),
  // When set, /events cards link straight out here instead of the internal
  // event page — for flagship events with their own site (e.g. Hacklanta).
  external_url: optionalUrl,
  // Sorts first in the Upcoming feed regardless of starts_at.
  pinned: z.coerce.boolean().optional().default(false),
  hosts: z.array(hostSchema).default([]),
} as const;

export const createEventSchema = z
  .object(eventBaseShape)
  .strict()
  .refine(
    (data) => new Date(data.starts_at).getTime() < new Date(data.ends_at).getTime(),
    { message: "Start must be before end", path: ["ends_at"] }
  );

export type CreateEventInput = z.input<typeof createEventSchema>;
export type CreateEventPayload = z.output<typeof createEventSchema>;

// For updates every field is optional; we still enforce start<end if both are set.
export const updateEventSchema = z
  .object({
    slug: eventBaseShape.slug.optional(),
    title: eventBaseShape.title.optional(),
    description_md: eventBaseShape.description_md,
    visibility: eventBaseShape.visibility.optional(),
    starts_at: eventBaseShape.starts_at.optional(),
    ends_at: eventBaseShape.ends_at.optional(),
    location_text: eventBaseShape.location_text,
    location_url: eventBaseShape.location_url,
    capacity: eventBaseShape.capacity,
    waitlist_enabled: z.coerce.boolean().optional(),
    is_sensitive: z.coerce.boolean().optional(),
    send_rsvp_email: z.coerce.boolean().optional(),
    send_reminder_email: z.coerce.boolean().optional(),
    cover_image_path: eventBaseShape.cover_image_path,
    external_url: eventBaseShape.external_url,
    pinned: z.coerce.boolean().optional(),
    hosts: z.array(hostSchema).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (!data.starts_at || !data.ends_at) return true;
      return (
        new Date(data.starts_at).getTime() < new Date(data.ends_at).getTime()
      );
    },
    { message: "Start must be before end", path: ["ends_at"] }
  );

export type UpdateEventInput = z.input<typeof updateEventSchema>;
export type UpdateEventPayload = z.output<typeof updateEventSchema>;

export const cancelEventSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Reason required")
    .max(2000, "Reason must be 2000 characters or fewer"),
});

// Member-side actions. Kept in this schema module (not "use server"-annotated
// action file) so client components can reference the input types.

export const RSVP_DESIRED = ["going", "declined", "cancelled"] as const;
export type RsvpDesired = (typeof RSVP_DESIRED)[number];

export const rsvpToEventSchema = z.object({
  eventId: z.string().uuid("Invalid event id."),
  desired: z.enum(RSVP_DESIRED),
  comment: z
    .string()
    .trim()
    .max(500, "Comment must be 500 characters or fewer")
    .optional()
    .nullable()
    .transform((v) => (v == null || v.length === 0 ? null : v)),
});

export type RsvpToEventInput = z.input<typeof rsvpToEventSchema>;

// The SMS disclosure, split into the part that sells and the part the law
// requires. Rendered as two lines, stored as one string.
//
// SMS_CONSENT_HEADLINE is the only line most people read, so it names what
// they get rather than what we send: events and recruiter visits, the two
// things a member actually loses by not knowing. "Stop anytime" is there
// because the fear it answers — being stuck on a list — is the main reason
// people decline, and it costs nothing to answer it up front.
//
// SMS_CONSENT_FINE_PRINT is not editorial. Carriers check for all four of
// frequency, rates, STOP and HELP at campaign review, and a 10DLC campaign
// gets rejected or deregistered without them. Shorten the headline freely;
// leave these four alone.
export const SMS_CONSENT_HEADLINE =
  "Text me about events and recruiter visits. Stop anytime.";

export const SMS_CONSENT_FINE_PRINT =
  "Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. See our Terms and Privacy Policy.";

// Stored verbatim with each consent so we can prove later what someone
// actually agreed to. It is the two visible lines joined, in the order they
// appear on screen — the record has to match what was in front of them, so
// this is derived rather than written out a second time.
export const SMS_CONSENT_COPY = `${SMS_CONSENT_HEADLINE} ${SMS_CONSENT_FINE_PRINT}`;

// Account-free guest RSVP (2026-08-21 decision). Phone regex matches the
// onboarding profile form's (lib/actions/profile-schemas.ts).
export const guestRsvpToEventSchema = z.object({
  eventId: z.string().uuid("Invalid event id."),
  name: z.string().trim().min(1, "Name required").max(100, "Name is too long"),
  email: z.string().trim().email("Enter a valid email").max(255),
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .refine(isValidUsPhone, US_PHONE_ERROR),
  smsOptIn: z.boolean().default(false),
});

export type GuestRsvpToEventInput = z.input<typeof guestRsvpToEventSchema>;


// Cover-image upload. Limit of 5 MB mirrors the DB's event-covers bucket
// `file_size_limit`. Allowed MIME types match the bucket's `allowed_mime_types`.
export const MAX_EVENT_COVER_BYTES = 5 * 1024 * 1024;
export const EVENT_COVER_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const createEventCoverUploadUrlSchema = z.object({
  eventId: z.string().uuid("Invalid event id."),
  contentType: z.enum(EVENT_COVER_MIME_TYPES),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_EVENT_COVER_BYTES, "Cover must be 5 MB or less"),
});

export type CreateEventCoverUploadUrlInput = z.input<
  typeof createEventCoverUploadUrlSchema
>;
