import { requireUser } from "@/lib/mobile/auth";
import { deviceBody } from "@/lib/mobile/contracts";
import { json, mobileRoute, pgError, rateLimit, readJson } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = mobileRoute("devices.register", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  await rateLimit("device", auth.user.id, 30, 3600);
  const body = await readJson(req, deviceBody);
  const { error } = await auth.supabase.rpc("register_device_token", { p_token: body.token, p_env: body.env });
  if (error) throw pgError(error);
  return json({ registered: true }, requestId);
});
