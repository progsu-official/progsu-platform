import { optionalUser, anonClient } from "@/lib/mobile/auth";
import { toEventSummaries } from "@/lib/mobile/data";
import { decodeCursor, encodeCursor, json, mobileRoute, pageLimit, pgError } from "@/lib/mobile/http";
import { requireEventsOn } from "@/lib/mobile/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Parameters<typeof toEventSummaries>[1][number];

export const GET = mobileRoute("events.list", async ({ req, requestId }) => {
  requireEventsOn();
  const auth = await optionalUser(req);
  const limit = pageLimit(req);
  const cursor = decodeCursor(req.nextUrl.searchParams.get("cursor"));
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100).toLowerCase();
  const nowIso = new Date().toISOString();

  let rows: Row[];
  const supabase = auth?.supabase ?? anonClient();
  if (auth) {
    // member_visible_events applies can_view_event-equivalent rules for auth.uid().
    let query = auth.supabase
      .from("member_visible_events")
      .select("id, slug, title, starts_at, ends_at, location_text, cover_image_path, capacity, waitlist_enabled, going_count, external_url, pinned")
      .gte("ends_at", nowIso)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit + 1);
    if (cursor) {
      query = query.or(`starts_at.gt.${cursor.ts},and(starts_at.eq.${cursor.ts},id.gt.${cursor.id})`);
    }
    if (q) query = query.ilike("title", `%${q.replace(/[\\%_,()]/g, " ")}%`);
    const { data, error } = await query;
    if (error) throw pgError(error);
    rows = (data ?? []) as Row[];
  } else {
    const { data, error } = await anonClient().rpc("public_upcoming_events", { p_limit: 500 });
    if (error) throw pgError(error);
    rows = ((data ?? []) as Row[])
      .filter((r) => r.ends_at >= nowIso)
      .filter((r) => !q || r.title.toLowerCase().includes(q))
      .sort((a, b) => (a.starts_at === b.starts_at ? a.id.localeCompare(b.id) : Date.parse(a.starts_at) - Date.parse(b.starts_at)))
      .filter((r) => {
        if (!cursor) return true;
        const t = Date.parse(r.starts_at);
        const c = Date.parse(cursor.ts);
        return t > c || (t === c && r.id > cursor.id);
      })
      .slice(0, limit + 1);
  }

  const more = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = await toEventSummaries(supabase, pageRows);
  const last = pageRows[pageRows.length - 1];
  return json(
    { items, nextCursor: more && last ? encodeCursor(new Date(last.starts_at).toISOString(), last.id) : null },
    requestId
  );
});
