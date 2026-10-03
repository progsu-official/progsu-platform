import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/mobile/auth";
import { linkVerifyBody } from "@/lib/mobile/contracts";
import { fail, json, mobileRoute, pgError, rateLimit, readJson } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = mobileRoute("hacklanta.link.verify", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  await rateLimit("hl_link_verify", auth.user.id, 10, 3600);
  const body = await readJson(req, linkVerifyBody);
  const { data, error } = await createAdminClient().rpc("hacklanta_link_code_verify", {
    p_user_id: auth.user.id,
    p_code: body.code,
  });
  if (error) throw pgError(error);
  const row = (data ?? [])[0] as { status: string; attempts_remaining: number } | undefined;
  switch (row?.status) {
    case "linked":
      return json({ linked: true }, requestId);
    case "expired":
      fail("invalid_input", "That code has expired. Request a new one.", { field: "code" });
    case "locked":
      fail("rate_limited", "Too many incorrect attempts. Request a new code.");
    case "taken":
      fail("conflict", "That application is already linked to another Progsu account.");
    case "no_code":
      fail("invalid_input", "Request a code first.", { field: "code" });
    default:
      fail("invalid_input", "Incorrect code.", { field: "code" });
  }
});
