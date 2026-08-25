import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { readEventCounts, type AdminClient } from "./counts";

// Everything the daily recap needs, assembled on the service-role client.
//
// Direct table reads rather than admin_platform_analytics(): that helper
// re-checks is_admin against auth.uid(), and a cron worker has no session to
// check. Adding a service_role variant would mean a new function in `public`,
// which is CLAUDE.md hard rule #10 territory for the sake of numbers we can
// read straight off the tables.
//
// Nothing here is per-person. The recap counts RSVPs, it never names one —
// which is why it sits behind its own flag and needs no consent bump, unlike
// the per-RSVP alert next door.

const EVENT_TIME_ZONE = "America/New_York";
const SERIES_DAYS = 14;
const UPCOMING_LIMIT = 4;
const CAMPAIGN_LIMIT = 4;

export type RecapEventSummary = {
  title: string;
  slug: string;
  startsAt: string;
  capacity: number | null;
  goingCount: number;
  waitlistedCount: number;
};

export type RecapCampaign = {
  slug: string;
  label: string;
  clicks: number;
  rsvps: number;
};

export type RecapStats = {
  /** Start of the window this recap describes. */
  since: string;
  rsvps: {
    window: number;
    windowGuests: number;
    last7: number;
    previous7: number;
    dailyAverage7: number;
  };
  newMembers: number;
  /** Oldest-first, one entry per day, gaps filled with zero. */
  timeSeries: Array<{ date: string; count: number }>;
  upcoming: RecapEventSummary[];
  campaigns: RecapCampaign[];
};

/** `YYYY-MM-DD` in the timezone the events actually happen in. */
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: EVENT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayKey(iso: string | Date): string {
  return dayKeyFormat.format(typeof iso === "string" ? new Date(iso) : iso);
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * One entry per day for the last `SERIES_DAYS`, oldest first, zero-filled.
 * A chart that silently drops empty days draws a flat line through a dead
 * week and makes it look like a busy one.
 */
function buildSeries(stamps: string[], now: Date): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  for (const stamp of stamps) {
    const key = dayKey(stamp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: SERIES_DAYS }, (_, index) => {
    const date = dayKey(daysAgo(now, SERIES_DAYS - 1 - index));
    return { date, count: counts.get(date) ?? 0 };
  });
}

function countSince(stamps: string[], from: Date, to: Date): number {
  const start = from.getTime();
  const end = to.getTime();
  return stamps.filter((s) => {
    const t = new Date(s).getTime();
    return t >= start && t < end;
  }).length;
}

export async function buildRecapStats(
  now: Date = new Date(),
  windowHours = 24
): Promise<RecapStats> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const seriesStart = daysAgo(now, SERIES_DAYS);

  const [memberStamps, guestStamps, newMembers, upcoming] = await Promise.all([
    readMemberRsvpStamps(admin, seriesStart),
    readGuestRsvpStamps(admin, seriesStart),
    countNewMembers(admin, since),
    readUpcomingEvents(admin, now),
  ]);

  const allStamps = [...memberStamps, ...guestStamps];
  const last7 = countSince(allStamps, daysAgo(now, 7), now);
  const previous7 = countSince(allStamps, daysAgo(now, 14), daysAgo(now, 7));

  return {
    since: since.toISOString(),
    rsvps: {
      window: countSince(allStamps, since, now),
      windowGuests: countSince(guestStamps, since, now),
      last7,
      previous7,
      dailyAverage7: Math.round((last7 / 7) * 10) / 10,
    },
    newMembers,
    timeSeries: buildSeries(allStamps, now),
    upcoming,
    campaigns: await readCampaigns(admin, since),
  };
}

// Transitions into 'going', which is the same edge the confirmation email and
// the per-RSVP alert use. status_changed_at rather than rsvp_at, so a member
// who moves off the waitlist counts on the day they actually got a seat.
async function readMemberRsvpStamps(admin: AdminClient, from: Date): Promise<string[]> {
  const { data } = await admin
    .from("event_rsvps")
    .select("status_changed_at")
    .eq("status", "going")
    .gte("status_changed_at", from.toISOString())
    .limit(5000);
  return (data ?? []).map((row) => row.status_changed_at as string);
}

async function readGuestRsvpStamps(admin: AdminClient, from: Date): Promise<string[]> {
  const { data } = await admin
    .from("event_guest_rsvps")
    .select("created_at")
    .eq("status", "going")
    .gte("created_at", from.toISOString())
    .limit(5000);
  return (data ?? []).map((row) => row.created_at as string);
}

async function countNewMembers(admin: AdminClient, from: Date): Promise<number> {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .gte("created_at", from.toISOString());
  return count ?? 0;
}

// The same allowlist the per-RSVP alert applies, for the same reason: the
// recap lands in a channel the whole server reads, so a sensitive or
// private-invite event must not appear in it even as a line item.
async function readUpcomingEvents(
  admin: AdminClient,
  now: Date
): Promise<RecapEventSummary[]> {
  const { data } = await admin
    .from("events")
    .select("id, slug, title, starts_at, capacity")
    .eq("status", "published")
    .eq("visibility", "members")
    .eq("is_sensitive", false)
    .gte("starts_at", now.toISOString())
    .order("starts_at", { ascending: true })
    .limit(UPCOMING_LIMIT);

  const rows = data ?? [];
  return Promise.all(
    rows.map(async (row) => {
      const counts = await readEventCounts(admin, row.id as string);
      return {
        title: row.title as string,
        slug: row.slug as string,
        startsAt: row.starts_at as string,
        capacity: (row.capacity as number | null) ?? null,
        goingCount: counts.going,
        waitlistedCount: counts.waitlisted,
      };
    })
  );
}

async function readCampaigns(admin: AdminClient, from: Date): Promise<RecapCampaign[]> {
  if (!env.FEATURE_REFERRAL_LINKS) return [];

  const { data: hits } = await admin
    .from("referral_link_hits")
    .select("link_id, kind")
    .gte("occurred_at", from.toISOString())
    .limit(5000);

  if (!hits?.length) return [];

  const tally = new Map<string, { clicks: number; rsvps: number }>();
  for (const hit of hits) {
    const id = hit.link_id as string;
    const entry = tally.get(id) ?? { clicks: 0, rsvps: 0 };
    if (hit.kind === "click") entry.clicks += 1;
    if (hit.kind === "rsvp") entry.rsvps += 1;
    tally.set(id, entry);
  }

  const { data: links } = await admin
    .from("referral_links")
    .select("id, slug, label")
    .in("id", [...tally.keys()]);

  return (links ?? [])
    .map((link) => ({
      slug: link.slug as string,
      label: link.label as string,
      ...(tally.get(link.id as string) ?? { clicks: 0, rsvps: 0 }),
    }))
    // RSVPs first: a link with one conversion beat a link with forty idle
    // clicks, and sorting by clicks would say the opposite.
    .sort((a, b) => b.rsvps - a.rsvps || b.clicks - a.clicks)
    .slice(0, CAMPAIGN_LIMIT);
}
