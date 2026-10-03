import { requireUser } from "@/lib/mobile/auth";
import { ts } from "@/lib/mobile/data";
import { decodeCursor, encodeCursor, json, mobileRoute, pageLimit, pgError } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("me.points", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  const limit = pageLimit(req);
  const cursor = decodeCursor(req.nextUrl.searchParams.get("cursor"));

  let q = auth.supabase
    .from("point_ledger")
    .select("id, amount, kind, event_id, reason, created_at, events(title)")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.or(`created_at.lt.${cursor.ts},and(created_at.eq.${cursor.ts},id.lt.${cursor.id})`);
  const [{ data, error }, bal] = await Promise.all([q, auth.supabase.rpc("points_balance", { p_user_id: auth.user.id })]);
  if (error) throw pgError(error);
  if (bal.error) throw pgError(bal.error);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const more = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  return json(
    {
      balance: Number(bal.data ?? 0),
      items: pageRows.map((r) => ({
        id: String(r.id),
        amount: Number(r.amount),
        kind: r.kind as "award" | "reversal" | "adjustment",
        eventId: (r.event_id as string | null) ?? null,
        eventTitle: ((r.events as { title?: string } | null)?.title ?? null) as string | null,
        reason: (r.reason as string | null) ?? null,
        createdAt: ts(r.created_at as string),
      })),
      nextCursor: more && last ? encodeCursor(String(last.created_at), String(last.id)) : null,
    },
    requestId
  );
});
