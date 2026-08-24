import type { SupabaseClient } from "@supabase/supabase-js";

// Attendee social proof for list surfaces.
//
// The detail page calls event_attendee_faces(event_id) once. A list can't do
// that — 50 rows is 50 round-trips — so it calls the batch sibling instead
// (migration 20260824100000). Same visibility gate, same fold (live RSVPs +
// guest RSVPs + approved historical attendance), same "counted but never
// named" rule for imported legacy attendees.
//
// Events the caller cannot see are simply absent from the result, so callers
// should treat a missing id as "nothing to show", not as an error.

export type AttendeeFace = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_slug: string | null;
};

export type AttendeeSummary = {
  total: number;
  faces: AttendeeFace[];
};

const FACES_PER_EVENT = 5;

export async function loadAttendeeFaces(
  supabase: SupabaseClient,
  eventIds: string[]
): Promise<Map<string, AttendeeSummary>> {
  const out = new Map<string, AttendeeSummary>();
  if (eventIds.length === 0) return out;

  const { data, error } = await supabase.rpc("event_attendee_faces_batch", {
    p_event_ids: eventIds,
    p_limit: FACES_PER_EVENT,
  });
  // Social proof is decoration on a list row. If the RPC fails, the row still
  // has its own going count from the feed query — degrade to that rather than
  // failing the whole tab.
  if (error || !data) return out;

  for (const raw of data as Array<Record<string, unknown>>) {
    const id = raw.event_id as string;
    if (!id) continue;
    out.set(id, {
      total: Number(raw.total_count ?? 0),
      faces: ((raw.faces as AttendeeFace[] | null) ?? []).filter(
        (f) => !!f?.user_id
      ),
    });
  }
  return out;
}
