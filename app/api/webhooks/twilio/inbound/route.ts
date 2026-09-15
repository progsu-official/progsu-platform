import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { loadTwilioAuthToken, verifyTwilioSignature } from "@/lib/sms/twilio";
import { createAdminClient } from "@/lib/supabase/admin";

// Inbound SMS to the Progsu number. The only job is honouring opt-outs: a
// STOP lands in sms_suppressions, which every send path checks, so the number
// is skipped by the next broadcast and by any row of the current one the
// worker has not reached yet.
//
// Not behind FEATURE_SMS. A kill switch for sending must not also switch off
// the thing that stops us texting people who asked us to stop.
//
// Replies (the STOP confirmation, HELP text) come from Twilio's own opt-out
// handling on the Messaging Service, so this answers with empty TwiML rather
// than sending a second confirmation.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The opt-out keywords registered on the Progsu campaign. OptOutType covers
// them when Advanced Opt-Out is on; the list covers it when it is not.
const STOP_KEYWORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE",
]);

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export async function POST(req: NextRequest) {
  const authToken = loadTwilioAuthToken();
  if (!authToken) {
    log.error("twilio inbound: TWILIO_AUTH_TOKEN missing, rejecting", {
      action: "twilio_inbound",
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const raw = await req.text();
  const params = new URLSearchParams(raw);
  // Rebuilt from the configured origin, not req.url: behind Vercel's proxy the
  // request URL is not guaranteed to be the one Twilio signed.
  const url = `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")}${req.nextUrl.pathname}${req.nextUrl.search}`;

  if (
    !verifyTwilioSignature({
      authToken,
      url,
      params,
      signature: req.headers.get("x-twilio-signature"),
    })
  ) {
    // Error, not warn: besides forgery, this is what a NEXT_PUBLIC_SITE_URL
    // that differs from the URL configured in Twilio looks like, and in that
    // state every real STOP is being dropped.
    log.error("twilio inbound: signature invalid", {
      action: "twilio_inbound",
      signed_url: url,
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const from = params.get("From") ?? "";
  const keyword = (params.get("Body") ?? "").trim().toUpperCase();
  const isStop = params.get("OptOutType") === "STOP" || STOP_KEYWORDS.has(keyword);

  if (isStop) {
    const admin = createAdminClient();
    const { error } = await admin.rpc("suppress_sms_number", {
      p_phone: from,
      p_reason: "stop_keyword",
      p_note: `inbound ${keyword.slice(0, 20)}`,
    });
    if (error) {
      // An opt-out that did not stick must be loud: a 500 surfaces in the
      // Twilio debugger and hits the fallback URL if one is set. The usual
      // cause is a From that is not a US number, which suppress_sms_number()
      // cannot canonicalise and we could never have texted anyway.
      log.error("twilio inbound: suppress failed", {
        action: "twilio_inbound",
        error_message: error.message,
      });
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    log.info("twilio inbound: number suppressed", { action: "twilio_inbound" });
  }

  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
