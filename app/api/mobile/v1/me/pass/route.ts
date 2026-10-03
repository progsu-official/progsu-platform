import { requireUser } from "@/lib/mobile/auth";
import { fail, json, mobileRoute, pgError } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Personal check-in QR: profiles.checkin_code (same payload the web QR
// encodes). shortCode is its first 8 hex chars, accepted by mobile_staff_scan
// for typing at the door.
export const GET = mobileRoute("me.pass", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  const { data, error } = await auth.supabase
    .from("profiles")
    .select("checkin_code")
    .eq("id", auth.user.id)
    .single();
  if (error) throw pgError(error);
  const code = (data as { checkin_code?: string } | null)?.checkin_code;
  if (!code) fail("not_found", "No check-in code.");
  return json({ qrPayload: code, shortCode: code.slice(0, 8).toUpperCase() }, requestId);
});
