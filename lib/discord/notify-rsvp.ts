import "server-only";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEventCounts, type AdminClient } from "./counts";
import { buildRsvpAlert, publicDisplayName, type RsvpAlert } from "./rsvp-alert";
import { executeWebhook } from "./webhook";

// Announces an RSVP in the Progsu Discord.
//
// Three properties this file has to hold, in order of how badly they hurt
// when broken:
//
//   1. It never throws and it is never awaited. An RSVP that failed because
//      Discord was down would be the worst possible trade.
//   2. It never announces an event the channel is not allowed to know about.
//      The channel is the whole server, so draft, private-invite and
//      is_sensitive events are refused outright — see shouldAnnounce().
//   3. It names people the way docs/18-discord-rsvp-alerts.md says it may:
//      first name and a last initial, never an email or a phone number.
//
// Reads run on the service-role client because the guest path has no session
// at all — an anon caller cannot read `events`, let alone the RSVP counts.

type AnnouncableEvent = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  location_text: string | null;
  capacity: number | null;
  status: string;
  visibility: string;
  is_sensitive: boolean;
};

export type RsvpNotificationInput = {
  eventId: string;
  kind: RsvpAlert["kind"];
  /** Present for the member path; the guest path passes a name instead. */
  userId?: string;
  /**
   * Present for the guest path. The row is read back rather than trusting the
   * submitted name, because that read is also what tells us whether this was
   * a first submit or someone hitting the form twice — see FRESH_RSVP_MS.
   */
  guestEmail?: string;
  /** Campaign slug from the attribution cookie, read by the caller. */
  campaignSlug?: string | null;
};

/**
 * The gate that keeps a whole-server channel from learning about events its
 * readers cannot see. Deliberately allowlist-shaped: a future status or
 * visibility value is refused until someone decides it is safe.
 */
function shouldAnnounce(event: AnnouncableEvent): boolean {
  if (event.is_sensitive) return false;
  if (event.status !== "published") return false;
  if (event.visibility !== "members") return false;
  return true;
}

function eventUrlFor(slug: string): string {
  return `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/events/${slug}`;
}

export async function notifyRsvp(input: RsvpNotificationInput): Promise<void> {
  if (!env.FEATURE_DISCORD_RSVP_ALERTS) return;
  const webhookUrl = process.env.DISCORD_RSVP_WEBHOOK_URL;
  if (!webhookUrl) return;

  const admin = createAdminClient();

  const { data: event, error: eventError } = await admin
    .from("events")
    .select(
      "id, slug, title, starts_at, location_text, capacity, status, visibility, is_sensitive"
    )
    .eq("id", input.eventId)
    .maybeSingle<AnnouncableEvent>();

  if (eventError || !event) {
    log.warn("discord rsvp alert: event read failed", {
      action: "discord.notify_rsvp",
      event_id: input.eventId,
      error_code: eventError?.code ?? "not_found",
    });
    return;
  }

  if (!shouldAnnounce(event)) return;

  const isGuest = !input.userId;

  // Resolve who this is first. On the guest path the answer can be "nobody
  // new", which ends the call before we spend four more queries on counts.
  const attendee = isGuest
    ? await resolveGuestAttendee(admin, event.id, input.guestEmail ?? "")
    : await resolveAttendeeName(admin, input.userId!);
  if (attendee === null) return;

  const [counts, campaign] = await Promise.all([
    readEventCounts(admin, event.id),
    resolveCampaign(admin, input.campaignSlug ?? null),
  ]);

  const alert: RsvpAlert = {
    kind: input.kind,
    attendeeName: attendee,
    isGuest,
    campaign,
    event: {
      title: event.title,
      url: eventUrlFor(event.slug),
      startsAt: event.starts_at,
      locationText: event.location_text,
      capacity: event.capacity,
      goingCount: counts.going,
      waitlistedCount: counts.waitlisted,
    },
  };

  await executeWebhook({
    webhookUrl,
    message: buildRsvpAlert(alert, new Date()),
  });
}

/**
 * Fire-and-forget wrapper for the RSVP server actions. Swallows everything —
 * the caller has already succeeded by the time this runs.
 */
export function notifyRsvpInBackground(input: RsvpNotificationInput): void {
  void notifyRsvp(input).catch((e) => {
    log.error("discord rsvp alert failed", {
      action: "discord.notify_rsvp",
      event_id: input.eventId,
      kind: input.kind,
      error_code: e instanceof Error ? e.message : String(e),
    });
  });
}

// How recently a guest row must have been created for this submit to count as
// new. The guest RPC upserts and returns no prior status, so without this a
// visitor who refreshes the confirmation page or re-submits the form posts the
// same announcement again. Generous enough to cover a slow round trip, far
// short of anything that would swallow a genuinely separate RSVP.
const FRESH_RSVP_MS = 30_000;

/**
 * The guest's public name, or null when this submit is not news — an unknown
 * row, or one that already existed before this request started.
 */
async function resolveGuestAttendee(
  admin: AdminClient,
  eventId: string,
  email: string
): Promise<string | null> {
  if (!email) return null;

  const { data } = await admin
    .from("event_guest_rsvps")
    .select("name, created_at")
    .eq("event_id", eventId)
    .eq("email", email)
    .maybeSingle<{ name: string; created_at: string }>();

  if (!data) return null;
  const age = Date.now() - new Date(data.created_at).getTime();
  if (!Number.isFinite(age) || age > FRESH_RSVP_MS) return null;

  return publicDisplayName(data.name);
}

async function resolveAttendeeName(
  admin: AdminClient,
  userId: string
): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("first_name, last_name, preferred_name")
    .eq("id", userId)
    .maybeSingle<{
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
    }>();

  const first = data?.preferred_name?.trim() || data?.first_name?.trim() || "";
  const last = data?.last_name?.trim() || "";
  return publicDisplayName(`${first} ${last}`.trim());
}

async function resolveCampaign(
  admin: AdminClient,
  slug: string | null
): Promise<RsvpAlert["campaign"]> {
  if (!slug || !env.FEATURE_REFERRAL_LINKS) return null;

  // Direct table read rather than admin_referral_links_for(): that helper
  // re-checks is_admin against auth.uid(), and the guest path has no session
  // to check. Service-role bypasses RLS, and this is a read of a label the
  // officer typed — not a widening of what referral_link_hits stores.
  const { data } = await admin
    .from("referral_links")
    .select("slug, label")
    .eq("slug", slug)
    .maybeSingle<{ slug: string; label: string }>();

  return data ? { slug: data.slug, label: data.label } : null;
}
