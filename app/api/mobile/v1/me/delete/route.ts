import { requireUser } from "@/lib/mobile/auth";
import { deleteBody } from "@/lib/mobile/contracts";
import { deleteAccount } from "@/lib/mobile/deletion";
import { json, mobileRoute, rateLimit, readJson } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Idempotent: a retry after a partial failure resumes; once the auth user is
// gone the bearer stops verifying, so a repeat call answers 401.
export const POST = mobileRoute("me.delete", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  await rateLimit("delete", auth.user.id, 5, 3600);
  await readJson(req, deleteBody);
  const result = await deleteAccount(auth.user.id, "mobile");
  return json(result, requestId);
});
