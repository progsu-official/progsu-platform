import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { toUsE164 } from "@/lib/sms/hacklanta-sync";
import { loadTwilioSendConfig, sendSms } from "@/lib/sms/twilio";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamFinderSyncAuthed } from "@/lib/team-finder-sync-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const acceptanceSmsBody = `Good news! We have an update on your Hacklanta '26 application.

Please check your email inbox (including spam folder) for more info.

- Team Hacklanta`;

export async function POST(req: NextRequest) {
  if (!teamFinderSyncAuthed(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: { to?: unknown };
  try {
    body = (await req.json()) as { to?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? toUsE164(body.to) : null;
  if (!to) {
    return NextResponse.json({ ok: false, error: "invalid_phone" }, { status: 400 });
  }

  const config = loadTwilioSendConfig();
  if (!config) {
    return NextResponse.json({ ok: false, error: "sms_unavailable" }, { status: 503 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: suppression, error: suppressionError } = await admin
    .from("sms_suppressions")
    .select("phone_e164")
    .eq("phone_e164", to)
    .maybeSingle();
  if (suppressionError) {
    return NextResponse.json({ ok: false, error: "sms_tracking_failed" }, { status: 500 });
  }
  if (suppression) {
    return NextResponse.json({ ok: false, error: "sms_suppressed" }, { status: 409 });
  }

  const { error: recipientError } = await admin
    .from("hacklanta_sms_recipients")
    .upsert(
      { phone_e164: to, email_sent_at: now },
      { onConflict: "phone_e164" },
    );
  if (recipientError) {
    return NextResponse.json({ ok: false, error: "sms_tracking_failed" }, { status: 500 });
  }

  const { data: broadcast, error: broadcastError } = await admin
    .from("sms_broadcasts")
    .insert({
      body: acceptanceSmsBody,
      audience: "hacklanta_accepted",
      status: "done",
      recipient_count: 1,
      completed_at: now,
    })
    .select("id")
    .single();
  if (broadcastError) {
    return NextResponse.json({ ok: false, error: "sms_tracking_failed" }, { status: 500 });
  }

  const { data: delivery, error: deliveryError } = await admin
    .from("sms_deliveries")
    .insert({
      broadcast_id: broadcast.id,
      phone_e164: to,
      status: "sending",
      attempts: 1,
      claimed_at: now,
      status_updated_at: now,
    })
    .select("id")
    .single();
  if (deliveryError) {
    return NextResponse.json({ ok: false, error: "sms_tracking_failed" }, { status: 500 });
  }

  const result = await sendSms(config, {
    to,
    body: acceptanceSmsBody,
    statusCallback: `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")}/api/webhooks/twilio/status`,
  });
  if (!result.ok) {
    await admin
      .from("sms_deliveries")
      .update({
        status: "failed",
        error_code: result.code,
        error_message: result.message,
        status_updated_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);
    log.error("hacklanta acceptance SMS failed", {
      action: "hacklanta_acceptance_sms",
      error_code: result.code ?? undefined,
      error_message: result.message,
    });
    return NextResponse.json(
      { ok: false, error: "sms_delivery_failed", code: result.code },
      { status: 502 },
    );
  }

  const sentAt = new Date().toISOString();
  const { error: sentTrackingError } = await admin
    .from("sms_deliveries")
    .update({
      status: "sent",
      twilio_sid: result.sid,
      sent_at: sentAt,
      status_updated_at: sentAt,
    })
    .eq("id", delivery.id);
  if (sentTrackingError) {
    log.error("hacklanta acceptance SMS tracking failed after send", {
      action: "hacklanta_acceptance_sms",
      error_message: sentTrackingError.message,
    });
  }

  return NextResponse.json({ ok: true, sid: result.sid, status: result.status });
}
