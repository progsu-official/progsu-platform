import { appleRevocationConfigured, exchangeAndStoreAppleCode } from "@/lib/mobile/apple";
import { requireUser } from "@/lib/mobile/auth";
import { appleAuthorizationBody } from "@/lib/mobile/contracts";
import { fail, json, mobileRoute, rateLimit, readJson } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = mobileRoute("me.apple_authorization", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  await rateLimit("apple_auth", auth.user.id, 10, 3600);
  const body = await readJson(req, appleAuthorizationBody);
  if (!appleRevocationConfigured()) fail("unavailable", "Apple sign-in revocation is not configured.");
  const outcome = await exchangeAndStoreAppleCode(auth.user.id, body.authorizationCode);
  if (outcome === "rejected") fail("invalid_input", "Apple rejected that authorization code.");
  return json({ stored: outcome === "stored" }, requestId);
});
