"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  createReferralLinkSchema,
  setReferralLinkArchivedSchema,
  type ReferralCampaignDashboard,
  type ReferralDashboard,
} from "./referrals-schemas";
import { type ActionResult, err, ok } from "./result";

// Admin-facing reads and writes for campaign links.
//
// These call the RPCs on the *user's* client, not the admin client, so
// auth.uid() inside the SECURITY DEFINER helpers resolves to the acting
// officer and the audit row names them. The helpers re-check is_admin
// themselves — this file's job is input validation and error shaping.
//
// Recording hits is deliberately not here: that runs on the service-role
// client from lib/events/referral-record.ts, because those RPCs have no
// caller identity to check and must stay unreachable from a browser.

function mapPgError(error: { code?: string | null; message?: string } | null) {
  if (!error) return err("INTERNAL", "Unknown database error.");
  const code = error.code ?? "";
  const msg = error.message ?? "Database error.";

  if (code === "23505") {
    return err("CONFLICT", "That link is already taken.", { field: "slug" });
  }
  if (code === "P0002") return err("NOT_FOUND", msg);
  if (code === "P0001") {
    const lower = msg.toLowerCase();
    if (lower.includes("admin only")) return err("FORBIDDEN", "Admins only.");
    if (lower.includes("already taken")) {
      return err("CONFLICT", "That link is already taken.", { field: "slug" });
    }
    // The remaining P0001s are the slug/label format messages, which are
    // written for a human and pass through as-is.
    if (lower.includes("slug")) return err("INVALID_INPUT", msg, { field: "slug" });
    if (lower.includes("label")) return err("INVALID_INPUT", msg, { field: "label" });
    return err("INVALID_INPUT", msg);
  }
  return err("INTERNAL", msg);
}

const EMPTY_DASHBOARD: ReferralDashboard = {
  links: [],
  totals: { links: 0, active: 0, clicks: 0, visitors: 0, rsvps: 0, signups: 0 },
  daily: [],
  days: 30,
};

export async function listReferralLinks(
  eventId: string
): Promise<ActionResult<ReferralDashboard>> {
  // Flag off returns an empty dashboard rather than an error: to an officer
  // that is indistinguishable from "no links yet", which is what a kill switch
  // should look like. Same contract as getSharedEventsForViewer.
  if (!env.FEATURE_REFERRAL_LINKS) return ok(EMPTY_DASHBOARD);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_referral_links_for", {
    p_event_id: eventId,
    p_days: 30,
  });
  if (error) return mapPgError(error);

  const payload = (data ?? {}) as Partial<ReferralDashboard>;
  return ok({
    links: payload.links ?? [],
    totals: payload.totals ?? EMPTY_DASHBOARD.totals,
    daily: payload.daily ?? [],
    days: payload.days ?? 30,
  });
}

const EMPTY_CAMPAIGNS: ReferralCampaignDashboard = {
  links: [],
  totals: EMPTY_DASHBOARD.totals,
  daily: [],
  events: [],
  days: 30,
};

/**
 * Every campaign across every event, for /admin/links.
 *
 * Same flag contract as the per-event read: off returns an empty dashboard
 * rather than an error, because to an officer that is indistinguishable from
 * "no links yet", which is what a kill switch should look like.
 */
export async function listAllReferralLinks(
  days = 30
): Promise<ActionResult<ReferralCampaignDashboard>> {
  if (!env.FEATURE_REFERRAL_LINKS) return ok(EMPTY_CAMPAIGNS);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_referral_links_all", {
    p_days: days,
  });
  if (error) return mapPgError(error);

  const payload = (data ?? {}) as Partial<ReferralCampaignDashboard>;
  return ok({
    links: payload.links ?? [],
    totals: payload.totals ?? EMPTY_CAMPAIGNS.totals,
    daily: payload.daily ?? [],
    events: payload.events ?? [],
    days: payload.days ?? days,
  });
}

export async function createReferralLink(
  input: unknown
): Promise<ActionResult<{ slug: string }>> {
  if (!env.FEATURE_REFERRAL_LINKS) {
    return err("FORBIDDEN", "Campaign links are turned off.");
  }

  const parsed = createReferralLinkSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_referral_link", {
    p_event_id: parsed.data.eventId,
    p_slug: parsed.data.slug === "" ? null : parsed.data.slug.toLowerCase(),
    p_label: parsed.data.label,
  });
  if (error) return mapPgError(error);

  const row = data as { slug?: string } | null;
  if (!row?.slug) return err("INTERNAL", "Link created but slug missing.");

  revalidatePath(`/admin/events/${parsed.data.eventId}`);
  revalidatePath("/admin/links");
  return ok({ slug: row.slug });
}

export async function setReferralLinkArchived(
  input: unknown
): Promise<ActionResult<{ archived: boolean }>> {
  if (!env.FEATURE_REFERRAL_LINKS) {
    return err("FORBIDDEN", "Campaign links are turned off.");
  }

  const parsed = setReferralLinkArchivedSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_referral_link", {
    p_id: parsed.data.linkId,
    p_archived: parsed.data.archived,
  });
  if (error) return mapPgError(error);

  revalidatePath(`/admin/events/${parsed.data.eventId}`);
  revalidatePath("/admin/links");
  return ok({ archived: parsed.data.archived });
}
