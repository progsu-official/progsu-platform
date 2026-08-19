import { z } from "zod";

// Re-used across the settings UI and the directory pages. Kept in a
// non-"use server" module so client components can import the types.

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const setProfileVisibilitySchema = z
  .object({
    discoverable: z.boolean().optional(),
    share_attended_events: z.boolean().optional(),
    share_shared_event_counts: z.boolean().optional(),
  })
  .strict();

export type SetProfileVisibilityInput = z.input<
  typeof setProfileVisibilitySchema
>;

export const setProfileSlugSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Slug must be at least 3 characters")
    .max(40, "Slug must be 40 characters or fewer")
    .regex(
      SLUG_REGEX,
      "Lowercase letters, numbers, and dashes only; cannot start or end with a dash"
    ),
});

export type SetProfileSlugInput = z.input<typeof setProfileSlugSchema>;

export const listMemberCardsSchema = z.object({
  // offset: true — PostgREST serializes timestamptz with a numeric offset
  // ("+00:00"), not the "Z" Zod's datetime() requires by default. Without
  // this, every real cursor_ts value from member_cards.visible_since fails
  // validation, breaking pagination past the first page for everyone.
  cursor_ts: z.string().datetime({ offset: true }).optional().nullable(),
  cursor_user: z.string().uuid().optional().nullable(),
  limit: z.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(64).optional().nullable(),
});

export type ListMemberCardsInput = z.input<typeof listMemberCardsSchema>;
