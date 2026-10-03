import { requireUser } from "@/lib/mobile/auth";
import { toEventSummaries, ts } from "@/lib/mobile/data";
import { json, mobileRoute, pgError } from "@/lib/mobile/http";
import { requireEventsOn } from "@/lib/mobile/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_COLS =
  "id, slug, title, starts_at, ends_at, location_text, cover_image_path, capacity, waitlist_enabled, external_url, pinned";

// RSVPs + attendance history for the caller. Reads only the caller's own rows
// (RLS), then the events they point at.
export const GET = mobileRoute("me.events", async ({ req, requestId }) => {
  requireEventsOn();
  const auth = await requireUser(req);
  const [rsvps, attendances] = await Promise.all([
    auth.supabase.from("event_rsvps").select("event_id, status").eq("user_id", auth.user.id).limit(500),
    auth.supabase.from("event_attendances").select("event_id, checked_in_at").eq("user_id", auth.user.id).limit(500),
  ]);
  if (rsvps.error) throw pgError(rsvps.error);
  if (attendances.error) throw pgError(attendances.error);

  const byEvent = new Map<string, { rsvpStatus: string | null; checkedInAt: string | null }>();
  for (const r of rsvps.data ?? []) byEvent.set(String(r.event_id), { rsvpStatus: String(r.status), checkedInAt: null });
  for (const a of attendances.data ?? []) {
    const cur = byEvent.get(String(a.event_id)) ?? { rsvpStatus: null, checkedInAt: null };
    cur.checkedInAt = ts(a.checked_in_at as string);
    byEvent.set(String(a.event_id), cur);
  }
  const ids = [...byEvent.keys()];
  if (ids.length === 0) return json({ items: [] }, requestId);

  const [{ data: events, error }, { data: counts }] = await Promise.all([
    auth.supabase.from("events").select(EVENT_COLS).in("id", ids).order("starts_at", { ascending: false }),
    // Counts come from the member view; past events outside it report 0.
    auth.supabase.from("member_visible_events").select("id, going_count").in("id", ids),
  ]);
  if (error) throw pgError(error);
  const goingById = new Map((counts ?? []).map((c) => [String(c.id), Number(c.going_count ?? 0)]));
  const rows = (events ?? []).map((e) => ({
    ...(e as Record<string, unknown>),
    going_count: goingById.get(String((e as { id: string }).id)) ?? 0,
  })) as unknown as Parameters<typeof toEventSummaries>[1];
  const summaries = await toEventSummaries(auth.supabase, rows);
  return json(
    {
      items: summaries.map((ev) => ({
        event: ev,
        rsvpStatus: (byEvent.get(ev.id)?.rsvpStatus ?? null) as never,
        checkedInAt: byEvent.get(ev.id)?.checkedInAt ?? null,
      })),
    },
    requestId
  );
});
