import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

// Live RSVP counts for one event, shared by the per-RSVP alert and the daily
// recap so the two can never disagree about how full a room is.
//
// Live only. The member-facing views fold approved historical attendances into
// their counts; that fold is right for "who has ever been", and wrong for
// "how full is this room right now", which is the only question either Discord
// surface asks.

export type AdminClient = ReturnType<typeof createAdminClient>;

export async function countMemberRsvps(
  admin: AdminClient,
  eventId: string,
  status: "going" | "waitlisted"
): Promise<number> {
  const { count } = await admin
    .from("event_rsvps")
    .select("user_id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", status);
  return count ?? 0;
}

export async function readGuestCounts(
  admin: AdminClient,
  eventId: string
): Promise<{ going: number; waitlisted: number }> {
  const { data } = await admin.rpc("event_guest_counts", { p_event_id: eventId });
  const row = Array.isArray(data) ? data[0] : null;
  return {
    going: Number(row?.going_count ?? 0),
    waitlisted: Number(row?.waitlisted_count ?? 0),
  };
}

export async function readEventCounts(
  admin: AdminClient,
  eventId: string
): Promise<{ going: number; waitlisted: number }> {
  const [going, waitlisted, guests] = await Promise.all([
    countMemberRsvps(admin, eventId, "going"),
    countMemberRsvps(admin, eventId, "waitlisted"),
    readGuestCounts(admin, eventId),
  ]);
  return {
    going: going + guests.going,
    waitlisted: waitlisted + guests.waitlisted,
  };
}
