import "server-only";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

import { eventReminderBody } from "./templates";
import { loadTwilioSendConfig } from "./twilio";

// Queues the 30-minute SMS reminder for every event that is due. Runs at the
// top of the per-minute sms-deliveries cron, just before the worker drains,
// so a reminder queued here goes out in the same invocation.
//
// Who and exactly-once live in the database (migration 20260915130000):
// enqueue_event_sms_reminder() stamps the event under a row lock and
// snapshots RSVP'd, textable numbers; the claim re-checks each one.

type DueEvent = {
  event_id: string;
  title: string;
  slug: string;
  starts_at: string;
  location_text: string | null;
};

export type ReminderEnqueueResult = {
  status: "ran" | "disabled" | "not_configured";
  events: number;
  recipients: number;
};

export async function enqueueDueEventReminders(): Promise<ReminderEnqueueResult> {
  const result: ReminderEnqueueResult = { status: "ran", events: 0, recipients: 0 };

  if (!env.FEATURE_SMS || !env.FEATURE_SMS_EVENT_REMINDERS) {
    return { ...result, status: "disabled" };
  }
  // Stamping an event without the means to send would use up its one
  // reminder for nothing.
  if (!loadTwilioSendConfig()) return { ...result, status: "not_configured" };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("due_event_sms_reminders");
  if (error) {
    log.error("sms reminders: due scan failed", { action: "sms_reminders", error_message: error.message });
    return result;
  }

  for (const ev of (data ?? []) as DueEvent[]) {
    const body = eventReminderBody({
      title: ev.title,
      slug: ev.slug,
      startsAt: ev.starts_at,
      locationText: ev.location_text,
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
    });
    const { data: enq, error: enqErr } = await admin.rpc("enqueue_event_sms_reminder", {
      p_event_id: ev.event_id,
      p_body: body,
    });
    if (enqErr) {
      log.error("sms reminders: enqueue failed", {
        action: "sms_reminders",
        event_id: ev.event_id,
        error_message: enqErr.message,
      });
      continue;
    }
    const row = enq as { enqueued: boolean; recipient_count: number };
    if (row.enqueued) {
      result.events += 1;
      result.recipients += row.recipient_count;
    }
  }

  if (result.events > 0) log.info("sms reminders: queued", { action: "sms_reminders", ...result });
  return result;
}
