import "server-only";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

import { loadTwilioAuthToken, loadTwilioSendConfig, sendSms } from "./twilio";

// Drains sms_deliveries. Runs from the per-minute cron and, right after an
// officer hits Send, from the server action's after() so a broadcast starts
// within seconds instead of on the next tick. Two runs at once are safe:
// claim_sms_deliveries() hands each row to exactly one of them.
//
// Twilio queues on its side and meters out at the sender's throughput, so the
// only pacing here is a small concurrency cap to stay polite to the API.
//
// Time budget: callers run under maxDuration = 60. A chunk is at most
// CONCURRENCY sends with a 15s timeout each, so the budget stops new chunks
// early enough that the last one finishes inside the function's lifetime.
// Rows claimed but not yet started when the budget runs out are released
// back to the queue; only a hard kill leaves rows in 'sending'.

type ClaimedRow = { delivery_id: string; to_phone: string; message_body: string };

export type SmsWorkerResult = {
  status: "ran" | "disabled" | "not_configured";
  claimed: number;
  sent: number;
  failed: number;
  released: number;
};

const CONCURRENCY = 5;

export async function runSmsDeliveryWorker({
  batchSize = 25,
  timeBudgetMs = 35_000,
}: {
  batchSize?: number;
  timeBudgetMs?: number;
} = {}): Promise<SmsWorkerResult> {
  const result: SmsWorkerResult = { status: "ran", claimed: 0, sent: 0, failed: 0, released: 0 };

  if (!env.FEATURE_SMS) return { ...result, status: "disabled" };

  // Check config before claiming anything. Claimed rows are never re-queued
  // once handed to Twilio, so claiming without the means to send would fail
  // them all.
  const config = loadTwilioSendConfig();
  if (!config) {
    log.error("sms worker: Twilio send config missing", { action: "sms_worker" });
    return { ...result, status: "not_configured" };
  }

  // Delivery receipts need a public https URL and the auth token to verify
  // them. Without both, sends still work; statuses just stop at "sent".
  const siteUrl = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  const statusCallback =
    loadTwilioAuthToken() && siteUrl.startsWith("https://")
      ? `${siteUrl}/api/webhooks/twilio/status`
      : undefined;

  const admin = createAdminClient();
  const deadline = Date.now() + timeBudgetMs;

  while (Date.now() < deadline) {
    const { data, error } = await admin.rpc("claim_sms_deliveries", { p_limit: batchSize });
    if (error) {
      log.error("sms worker: claim failed", { action: "sms_worker", error_message: error.message });
      break;
    }
    const rows = (data ?? []) as ClaimedRow[];
    result.claimed += rows.length;
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (Date.now() >= deadline) {
        const unsent = rows.slice(i).map((r) => r.delivery_id);
        const { data: released, error: relErr } = await admin.rpc("release_sms_deliveries", {
          p_ids: unsent,
        });
        if (relErr) {
          log.error("sms worker: release failed", {
            action: "sms_worker",
            error_message: relErr.message,
            rows: unsent.length,
          });
        } else {
          result.released += (released as number) ?? 0;
        }
        break;
      }

      await Promise.all(
        rows.slice(i, i + CONCURRENCY).map(async (row) => {
          const sent = await sendSms(config, {
            to: row.to_phone,
            body: row.message_body,
            statusCallback,
          });
          if (sent.ok) result.sent += 1;
          else result.failed += 1;

          const { error: finErr } = await admin.rpc("finish_sms_delivery", {
            p_delivery_id: row.delivery_id,
            p_ok: sent.ok,
            p_twilio_sid: sent.ok ? sent.sid : null,
            p_error_code: sent.ok ? null : sent.code,
            p_error_message: sent.ok ? null : sent.message.slice(0, 500),
          });
          if (finErr) {
            log.error("sms worker: finish failed", {
              action: "sms_worker",
              delivery_id: row.delivery_id,
              error_message: finErr.message,
            });
          }
        })
      );
    }
    // No short-batch exit: a batch can come back short because the claim
    // closed out suppressed rows, with more still queued behind them. An
    // empty claim ends the pass; anything it left behind is the next cron's.
  }

  log.info("sms worker: pass complete", { action: "sms_worker", ...result });
  return result;
}
