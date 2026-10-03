import { requireUser } from "@/lib/mobile/auth";
import { fail, json, mobileRoute, pgError } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = mobileRoute("devices.remove", async ({ req, requestId, params }) => {
  const token = params.token ?? "";
  if (!/^[0-9a-fA-F]{32,200}$/.test(token)) fail("not_found", "Not found.");
  const auth = await requireUser(req);
  const { data, error } = await auth.supabase.rpc("remove_device_token", { p_token: token });
  if (error) throw pgError(error);
  return json({ removed: data === true }, requestId);
});
