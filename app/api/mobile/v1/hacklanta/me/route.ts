import { requireUser } from "@/lib/mobile/auth";
import { hacklantaConfigured, readApplication } from "@/lib/mobile/hacklanta";
import { fail, json, mobileRoute, pgError } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("hacklanta.me", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  const { data: link, error } = await auth.supabase
    .from("hacklanta_links")
    .select("application_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) throw pgError(error);
  if (!link) return json({ linked: false, application: null }, requestId);
  if (!hacklantaConfigured()) fail("unavailable", "Hacklanta status is unavailable right now.");
  const application = await readApplication(String(link.application_id));
  return json({ linked: true, application }, requestId);
});
