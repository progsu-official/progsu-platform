import { z } from "zod";

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

export const rotateCheckInCodeSchema = z
  .object({
    raw_code: z
      .string()
      .trim()
      .min(4, "Code must be 4-20 characters")
      .max(20, "Code must be 4-20 characters"),
    expires_at: datetimeInputSchema,
  })
  .strict()
  .refine((d) => new Date(d.expires_at).getTime() > Date.now(), {
    message: "Expiration must be in the future",
    path: ["expires_at"],
  });

export type RotateCheckInCodeInput = z.input<typeof rotateCheckInCodeSchema>;

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

// Self-check-in raw code input. Trim + alphanumeric enforcement mirrors
// rotate_check_in_code_with_raw's DB-side length check (4-20). Alphanumeric is
// a stricter superset than the DB accepts; we keep it as a client hint so
// users don't paste whitespace/symbols that wouldn't match the admin-seeded
// code anyway. Actual comparison happens inside the RPC via pgcrypto.crypt().
export const selfCheckInSchema = z.object({
  eventId: z.string().uuid("Invalid event id."),
  rawCode: z
    .string()
    .trim()
    .min(4, "Code must be 4-20 characters")
    .max(20, "Code must be 4-20 characters")
    .regex(/^[A-Za-z0-9]+$/, "Code must be letters and numbers only"),
});

export type SelfCheckInInput = z.input<typeof selfCheckInSchema>;

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
