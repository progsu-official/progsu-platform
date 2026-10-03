import { verifyStudentEmailCodeFor } from "@/lib/domain/student-email";
import { requireUser } from "@/lib/mobile/auth";
import { studentEmailVerifyBody } from "@/lib/mobile/contracts";
import { json, mobileRoute, rateLimit, readJson } from "@/lib/mobile/http";
import { actionErrorToApi } from "@/lib/mobile/action-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = mobileRoute("me.student_email.verify", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  await rateLimit("otp_verify", auth.user.id, 20, 3600);
  const body = await readJson(req, studentEmailVerifyBody);
  const result = await verifyStudentEmailCodeFor(auth.user, body);
  if (!result.ok) throw actionErrorToApi(result.error);
  return json(result.data, requestId);
});
