import { randomInt } from "node:crypto";

import OtpEmail, { otpPlainText } from "@/emails/OtpEmail";
import { sendEmail } from "@/lib/email/resend";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/mobile/auth";
import { linkStartBody } from "@/lib/mobile/contracts";
import { findApplicationIdByEmail, hacklantaConfigured } from "@/lib/mobile/hacklanta";
import { fail, json, mobileRoute, pgError, rateLimit, readJson } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MINUTES = 10;

// Answers the same way whether or not an application matched, so this
// endpoint can't be used to learn who applied. Only a matched address gets an
// email, and only a matched code row can ever verify.
export const POST = mobileRoute("hacklanta.link.start", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  await rateLimit("hl_link_start", auth.user.id, 5, 3600);
  const body = await readJson(req, linkStartBody);
  await rateLimit("hl_link_start_email", body.email, 5, 3600);
  if (!hacklantaConfigured()) fail("unavailable", "Hacklanta linking is unavailable right now.");

  const applicationId = await findApplicationIdByEmail(body.email);
  const code = env.ONBOARDING_TEST_MODE ? "000000" : String(randomInt(0, 1_000_000)).padStart(6, "0");
  const admin = createAdminClient();
  const { data: expiresAt, error } = await admin.rpc("hacklanta_link_code_create", {
    p_user_id: auth.user.id,
    p_email: body.email,
    p_application_id: applicationId,
    p_code: code,
    p_ttl_minutes: TTL_MINUTES,
  });
  if (error) throw pgError(error);

  if (applicationId && !env.ONBOARDING_TEST_MODE) {
    const props = {
      code,
      expiresInMinutes: TTL_MINUTES,
      purpose: "link your Hacklanta application to the Progsu app",
      title: "Hacklanta application link",
    };
    const sent = await sendEmail({
      to: body.email,
      subject: "Your Hacklanta link code",
      react: OtpEmail(props),
      text: otpPlainText(props),
      idempotencyKey: `hl-link/${auth.user.id}/${Math.floor(Date.now() / 60_000)}`,
      tags: { purpose: "hacklanta_link" },
    });
    if (!sent.ok) fail("internal", "Could not send the code. Try again.");
  }
  return json({ expiresAt: new Date(String(expiresAt)).toISOString() }, requestId);
});
