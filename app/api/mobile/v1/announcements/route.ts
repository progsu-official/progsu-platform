import { anonClient, optionalUser } from "@/lib/mobile/auth";
import { ts } from "@/lib/mobile/data";
import { decodeCursor, encodeCursor, json, mobileRoute, pageLimit, pgError } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RLS (announcement_visible_to) scopes the feed to the caller's audience;
// signed out sees audience=all only.
export const GET = mobileRoute("announcements.list", async ({ req, requestId }) => {
  const auth = await optionalUser(req);
  const supabase = auth?.supabase ?? anonClient();
  const limit = pageLimit(req);
  const cursor = decodeCursor(req.nextUrl.searchParams.get("cursor"));
  let q = supabase
    .from("announcements")
    .select("id, title, body, audience, event_id, priority, deep_link, published_at, expires_at")
    .not("published_at", "is", null)
    .lte("published_at", new Date().toISOString())
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.or(`published_at.lt.${cursor.ts},and(published_at.eq.${cursor.ts},id.lt.${cursor.id})`);
  const { data, error } = await q;
  if (error) throw pgError(error);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const more = rows.length > limit;
  const pageRows = rows.slice(0, limit);

  let readIds = new Set<string>();
  if (auth && pageRows.length > 0) {
    const { data: reads } = await auth.supabase
      .from("announcement_reads")
      .select("announcement_id")
      .eq("user_id", auth.user.id)
      .in("announcement_id", pageRows.map((r) => String(r.id)));
    readIds = new Set((reads ?? []).map((r) => String(r.announcement_id)));
  }
  const last = pageRows[pageRows.length - 1];
  return json(
    {
      items: pageRows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        body: String(r.body),
        audience: r.audience as "all" | "event_rsvps" | "hacklanta",
        eventId: (r.event_id as string | null) ?? null,
        priority: r.priority as "normal" | "important",
        deepLink: (r.deep_link as string | null) ?? null,
        publishedAt: ts(r.published_at as string),
        expiresAt: ts(r.expires_at as string | null),
        read: auth ? readIds.has(String(r.id)) : null,
      })),
      nextCursor: more && last ? encodeCursor(String(last.published_at), String(last.id)) : null,
    },
    requestId
  );
});
