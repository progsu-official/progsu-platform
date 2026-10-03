import { recordConsentsSchema } from "@/lib/actions/consent-schemas";
import { recordConsentsFor } from "@/lib/domain/consents";
import { requireUser } from "@/lib/mobile/auth";
import { clientIp, fail, json, mobileRoute, parseOr400, readJson } from "@/lib/mobile/http";
import { consentsBody } from "@/lib/mobile/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = mobileRoute("me.consents", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  const raw = await readJson(req, consentsBody);
  const input = parseOr400(recordConsentsSchema, raw);
  const result = await recordConsentsFor(auth.supabase, auth.user, input, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  if (!result.ok) {
    fail(result.error.code === "INTERNAL" ? "internal" : "invalid_input",
      result.error.code === "INTERNAL" ? "Could not record consent." : result.error.message,
      { field: result.error.field });
  }
  return json(result.data, requestId);
});
