import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// Resend webhook. We treat hard bounces on student OTP emails as a signal that the
// email is bad and the user's student email should be un-verified so they re-verify
// (or pick a different email) next time they visit the app. We DON'T un-verify on
// soft bounces, complaints, or delivery events.

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type ResendEvent = {
  type?: string;
  data?: {
    to?: string[] | string;
    tags?: Array<{ name: string; value: string }> | Record<string, string>;
    subject?: string;
    bounce?: { type?: string };
  };
};

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("resend-signature") ?? req.headers.get("svix-signature");
  if (!verifySignature(raw, sig)) {
    log.warn("resend webhook signature invalid", {
      action: "resend_webhook",
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (event.type !== "email.bounced") {
    log.info("resend webhook ignored", {
      action: "resend_webhook",
      event_type: event.type,
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const bounceType = event.data?.bounce?.type;
  if (bounceType !== "hard" && bounceType !== "HardBounce") {
    // Soft bounces can self-resolve; don't un-verify.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const toRaw = event.data?.to;
  const to = Array.isArray(toRaw) ? toRaw[0] : toRaw;
  if (!to) return NextResponse.json({ ok: true, ignored: true });

  // Only un-verify when the bounce is on our OTP flow. The sendEmail wrapper tags
  // student OTP sends with purpose=student_otp.
  const tags = event.data?.tags;
  const purpose = Array.isArray(tags)
    ? tags.find((t) => t.name === "purpose")?.value
    : tags?.purpose;
  if (purpose !== "student_otp") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("profiles")
    .select("id")
    .eq("student_email", to)
    .maybeSingle();
  if (error || !row) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  await admin
    .from("profiles")
    .update({
      student_email_verified: false,
      student_email_verified_at: null,
    })
    .eq("id", row.id);

  // Audit via SECURITY DEFINER RPC. Actor=null because the caller is the webhook.
  await admin.rpc("write_audit", {
    p_action: "email_hard_bounce_unverified",
    p_actor: null,
    p_target: row.id,
    p_metadata: { email: to, bounce_type: bounceType },
  });

  log.warn("un-verified on hard bounce", {
    action: "resend_webhook",
    user_id: row.id,
    email: to,
  });

  return NextResponse.json({ ok: true, unverified: true });
}
