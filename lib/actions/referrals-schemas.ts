import { z } from "zod";

// Kept in a non-"use server" module so the Links tab's client components can
// import these types without pulling server-only action code into the bundle.
// Same split as event-schemas.ts.

// Mirrors the referral_links_slug_format check constraint in migration
// 20260824150000. Validating here as well as there is the point of hard rule
// "validate at every trust boundary" — the DB is the backstop, this is the
// error message a human actually reads.
export const referralSlugSchema = z
  .string()
  .trim()
  .min(3, "Link must be at least 3 characters")
  .max(40, "Link must be 40 characters or fewer")
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    "Lowercase letters, numbers, and dashes only; cannot start or end with a dash"
  );

export const createReferralLinkSchema = z.object({
  eventId: z.string().uuid(),
  // Empty means "mint me a random one", which is the default path — an
  // officer making a link for Discord at 1am should not have to name it.
  slug: z.union([z.literal(""), referralSlugSchema]).default(""),
  label: z
    .string()
    .trim()
    .min(1, "Give the link a name so you know what it was for")
    .max(80, "Name must be 80 characters or fewer"),
});

export const setReferralLinkArchivedSchema = z.object({
  linkId: z.string().uuid(),
  eventId: z.string().uuid(),
  archived: z.boolean(),
});

export type CreateReferralLinkInput = z.input<typeof createReferralLinkSchema>;

/** Funnel across every link on the event. */
export type ReferralTotals = {
  links: number;
  active: number;
  clicks: number;
  visitors: number;
  rsvps: number;
  signups: number;
};

/** One dense day of campaign activity. Empty days are real zeros. */
export type ReferralDay = {
  day: string;
  clicks: number;
  visitors: number;
  rsvps: number;
  signups: number;
};

export type ReferralDashboard = {
  links: ReferralLinkRow[];
  totals: ReferralTotals;
  daily: ReferralDay[];
  days: number;
};

/** One row of admin_referral_links_for(). All aggregate — see the migration. */
export type ReferralLinkRow = {
  id: string;
  slug: string;
  label: string;
  created_at: string;
  archived_at: string | null;
  created_by_name: string | null;
  clicks: number;
  visitors: number;
  rsvps: number;
  signups: number;
  last_hit_at: string | null;
};

// ---------------------------------------------------------------------------
// Cross-event campaign dashboard (/admin/links)
// ---------------------------------------------------------------------------

/** A link plus the event it promotes. Payload of admin_referral_links_all(). */
export type ReferralCampaignRow = ReferralLinkRow & {
  event_id: string;
  event_title: string;
  event_slug: string;
  event_starts_at: string;
  event_status: string;
};

/** An event a campaign can be attached to, for the create form's picker. */
export type ReferralEventOption = {
  id: string;
  title: string;
  slug: string;
  starts_at: string;
  status: string;
};

export type ReferralCampaignDashboard = {
  links: ReferralCampaignRow[];
  totals: ReferralTotals;
  daily: ReferralDay[];
  events: ReferralEventOption[];
  days: number;
};
