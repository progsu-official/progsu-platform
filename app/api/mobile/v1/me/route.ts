import { requireUser } from "@/lib/mobile/auth";
import { loadMe } from "@/lib/mobile/data";
import { json, mobileRoute } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("me", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  return json(await loadMe(auth.supabase, auth.user.id), requestId);
});
