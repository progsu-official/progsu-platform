import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { loadTwilioAuthToken, verifyTwilioSignature } from "@/lib/sms/twilio";
import { createAdminClient } from "@/lib/supabase/admin";

// Delivery receipts for broadcast texts. The worker only sets StatusCallback
// to this URL when TWILIO_AUTH_TOKEN is configured, so a missing token means
// Twilio was never told to call here.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authToken = loadTwilioAuthToken();
  if (!authToken) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const url = `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")}${req.nextUrl.pathname}${req.nextUrl.search}`;

  if (
    !verifyTwilioSignature({
      authToken,
      url,
      params,
      signature: req.headers.get("x-twilio-signature"),
    })
  ) {
    log.warn("twilio status: signature invalid", { action: "twilio_status" });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const sid = params.get("MessageSid");
  const status = params.get("MessageStatus");
  if (!sid || !status) {
    return NextResponse.json({ ok: false, error: "missing MessageSid or MessageStatus" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("record_sms_status", {
    p_twilio_sid: sid,
    p_status: status,
    p_error_code: params.get("ErrorCode") || null,
  });
  if (error) {
    log.error("twilio status: record failed", {
      action: "twilio_status",
      error_message: error.message,
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
