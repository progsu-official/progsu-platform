import { requireUser } from "@/lib/mobile/auth";
import { fail, json, mobileRoute, pgError, uuidParam } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = mobileRoute("announcements.read", async ({ req, requestId, params }) => {
  const id = uuidParam(params.id);
  const auth = await requireUser(req);
  const { error } = await auth.supabase
    .from("announcement_reads")
    .upsert({ announcement_id: id, user_id: auth.user.id }, { onConflict: "announcement_id,user_id", ignoreDuplicates: true });
  if (error) {
    // RLS check failure = not visible to this caller.
    if (error.code === "42501") fail("not_found", "Announcement not found.");
    throw pgError(error);
  }
  return json({ read: true }, requestId);
});
