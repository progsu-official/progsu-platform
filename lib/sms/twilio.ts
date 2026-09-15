import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { requireTwilioAuthToken, requireTwilioSendConfig } from "@/lib/env";

// Twilio REST adapter. Deliberately just fetch: two endpoints do not justify
// the SDK, and this keeps the request shape visible for the one thing that
// actually matters — every send goes through the Messaging Service, whose
// sender pool is the toll-free number carrying the verified use case.
//
// Nothing here decides who may be texted. That is sms_is_sendable() in the
// database, applied when a broadcast is created and again when the worker
// claims each row; this module only ever sees numbers that passed it.

export type TwilioSendConfig = ReturnType<typeof requireTwilioSendConfig>;

export type SendSmsResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; code: string | null; message: string };

export function loadTwilioSendConfig(): TwilioSendConfig | null {
  try {
    return requireTwilioSendConfig();
  } catch {
    return null;
  }
}

export function loadTwilioAuthToken(): string | null {
  try {
    return requireTwilioAuthToken();
  } catch {
    return null;
  }
}

export async function sendSms(
  config: TwilioSendConfig,
  input: { to: string; body: string; statusCallback?: string }
): Promise<SendSmsResult> {
  const form = new URLSearchParams({
    To: input.to,
    Body: input.body,
    MessagingServiceSid: config.messagingServiceSid,
  });
  if (input.statusCallback) form.set("StatusCallback", input.statusCallback);

  const auth = Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch (e) {
    // A timeout leaves it unknown whether Twilio accepted the message. The
    // caller records it as failed and never retries, which is the direction
    // that cannot produce a duplicate text.
    return { ok: false, code: null, message: e instanceof Error ? e.message : String(e) };
  }

  let payload: { sid?: string; status?: string; code?: number; message?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // Non-JSON error bodies fall through to the status-code message below.
  }

  if (res.ok && payload.sid) {
    return { ok: true, sid: payload.sid, status: payload.status ?? "queued" };
  }
  return {
    ok: false,
    code: payload.code != null ? String(payload.code) : null,
    message: payload.message ?? `Twilio responded ${res.status}`,
  };
}

// X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + each POST param as
// key+value, keys sorted)). `url` must be exactly what Twilio requested,
// including any query string.
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
export function verifyTwilioSignature(input: {
  authToken: string;
  url: string;
  params: URLSearchParams;
  signature: string | null;
}): boolean {
  if (!input.signature) return false;

  const keys = [...new Set(input.params.keys())].sort();
  let data = input.url;
  for (const key of keys) {
    for (const value of input.params.getAll(key)) data += key + value;
  }

  const expected = createHmac("sha1", input.authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(input.signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
