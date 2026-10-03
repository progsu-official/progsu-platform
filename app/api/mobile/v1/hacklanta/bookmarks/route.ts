import { requireUser } from "@/lib/mobile/auth";
import { json, mobileRoute, pgError } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("hacklanta.bookmarks", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  const { data, error } = await auth.supabase
    .from("session_bookmarks")
    .select("session_id")
    .eq("user_id", auth.user.id)
    .limit(500);
  if (error) throw pgError(error);
  return json({ sessionIds: (data ?? []).map((r) => String(r.session_id)) }, requestId);
});
