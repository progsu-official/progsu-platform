import { requireUser } from "@/lib/mobile/auth";
import { fail, json, mobileRoute, pgError, uuidParam } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = mobileRoute("hacklanta.bookmark.put", async ({ req, requestId, params }) => {
  const sessionId = uuidParam(params.sessionId, "sessionId");
  const auth = await requireUser(req);
  const { error } = await auth.supabase
    .from("session_bookmarks")
    .upsert({ user_id: auth.user.id, session_id: sessionId }, { onConflict: "user_id,session_id", ignoreDuplicates: true });
  if (error) {
    if (error.code === "42501" || error.code === "23503") fail("not_found", "Session not found.");
    throw pgError(error);
  }
  return json({ bookmarked: true }, requestId);
});

export const DELETE = mobileRoute("hacklanta.bookmark.delete", async ({ req, requestId, params }) => {
  const sessionId = uuidParam(params.sessionId, "sessionId");
  const auth = await requireUser(req);
  const { error } = await auth.supabase
    .from("session_bookmarks")
    .delete()
    .eq("user_id", auth.user.id)
    .eq("session_id", sessionId);
  if (error) throw pgError(error);
  return json({ bookmarked: false }, requestId);
});
