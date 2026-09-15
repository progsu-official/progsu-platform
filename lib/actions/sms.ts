"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { loadTwilioAuthToken, loadTwilioSendConfig } from "@/lib/sms/twilio";
import { runSmsDeliveryWorker } from "@/lib/sms/worker";
import { createClient } from "@/lib/supabase/server";

import { type ActionResult, err, ok } from "./result";
import {
  cancelSmsBroadcastSchema,
  createSmsBroadcastSchema,
  sendSmsTestSchema,
  setEventSmsReminderSchema,
  type SmsOverview,
} from "./sms-schemas";

// Officer-facing SMS actions for /admin/sms.
//
// Every call goes through the SECURITY DEFINER helpers on the officer's own
// client, so auth.uid() names them in the audit row and the helper re-checks
// is_admin. Recipient selection is entirely in the database
// (sms_is_sendable, migration 20260915120000); nothing in this file can widen
// who gets texted.

function mapPgError(error: { code?: string | null; message?: string } | null) {
  if (!error) return err("INTERNAL", "Unknown database error.");
  const code = error.code ?? "";
  const msg = (error.message ?? "Database error.").replace(/^[a-z_]+: /, "");

  if (code === "P0002") return err("NOT_FOUND", msg);
  if (code === "P0001") {
    const lower = msg.toLowerCase();
    if (lower.includes("admin only")) return err("FORBIDDEN", "Admins only.");
    if (lower.includes("audience changed") || lower.includes("still sending")) {
      return err("CONFLICT", msg);
    }
    return err("INVALID_INPUT", msg);
  }
  return err("INTERNAL", msg);
}

function firstIssue(error: { issues: Array<{ message: string; path: PropertyKey[] }> }) {
  const first = error.issues[0];
  return err("INVALID_INPUT", first?.message ?? "Invalid input", {
    field: first?.path.map(String).join("."),
  });
}

// Start sending as soon as the response is on its way back, rather than
// waiting up to a minute for the cron. The cron still finishes anything this
// pass does not.
function kickWorker() {
  after(async () => {
    try {
      await runSmsDeliveryWorker({ timeBudgetMs: 30_000 });
    } catch (e) {
      log.error("sms worker kick threw", {
        action: "sms_worker_kick",
        error_message: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

export async function getSmsOverview(): Promise<ActionResult<SmsOverview>> {
  if (!env.FEATURE_SMS) return err("NOT_FOUND", "SMS is turned off.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_sms_overview");
  if (error) return mapPgError(error);

  const payload = (data ?? {}) as Partial<SmsOverview> & {
    upcoming_reminders?: SmsOverview["upcomingReminders"];
  };
  return ok({
    audiences: payload.audiences ?? { gsu: 0, all_consented: 0 },
    suppressed: payload.suppressed ?? 0,
    self: payload.self ?? { has_phone: false, phone_last4: null, is_suppressed: false },
    broadcasts: payload.broadcasts ?? [],
    upcomingReminders: payload.upcoming_reminders ?? [],
    config: {
      canSend: loadTwilioSendConfig() !== null,
      receipts: loadTwilioAuthToken() !== null,
      eventReminders: env.FEATURE_SMS_EVENT_REMINDERS,
    },
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
  });
}

export async function sendSmsTest(
  input: unknown
): Promise<ActionResult<{ broadcastId: string }>> {
  if (!env.FEATURE_SMS) return err("FORBIDDEN", "SMS is turned off.");
  if (!loadTwilioSendConfig()) {
    return err("INTERNAL", "Twilio isn't configured on this deployment yet.");
  }

  const parsed = sendSmsTestSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sms_broadcast", {
    p_body: parsed.data.body,
    p_audience: "self_test",
    p_expected_count: null,
  });
  if (error) return mapPgError(error);

  kickWorker();
  revalidatePath("/admin/sms");
  return ok({ broadcastId: (data as { broadcast_id: string }).broadcast_id });
}

export async function createSmsBroadcast(
  input: unknown
): Promise<ActionResult<{ broadcastId: string; recipientCount: number }>> {
  if (!env.FEATURE_SMS) return err("FORBIDDEN", "SMS is turned off.");
  if (!loadTwilioSendConfig()) {
    return err("INTERNAL", "Twilio isn't configured on this deployment yet.");
  }

  const parsed = createSmsBroadcastSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sms_broadcast", {
    p_body: parsed.data.body,
    p_audience: parsed.data.audience,
    p_expected_count: parsed.data.expectedCount,
  });
  if (error) return mapPgError(error);

  const row = data as { broadcast_id: string; recipient_count: number };
  kickWorker();
  revalidatePath("/admin/sms");
  return ok({ broadcastId: row.broadcast_id, recipientCount: row.recipient_count });
}

// Per-event switch for the automatic 30-minute reminder. Not gated on
// FEATURE_SMS: an officer turning reminders off for a sensitive event should
// stick even while SMS as a whole is switched off.
export async function setEventSmsReminder(
  input: unknown
): Promise<ActionResult<{ enabled: boolean }>> {
  const parsed = setEventSmsReminderSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_event_sms_reminder", {
    p_event_id: parsed.data.eventId,
    p_enabled: parsed.data.enabled,
  });
  if (error) return mapPgError(error);

  revalidatePath(`/admin/events/${parsed.data.eventId}`);
  revalidatePath("/admin/sms");
  return ok({ enabled: parsed.data.enabled });
}

export async function cancelSmsBroadcast(
  input: unknown
): Promise<ActionResult<{ unsent: number }>> {
  if (!env.FEATURE_SMS) return err("FORBIDDEN", "SMS is turned off.");

  const parsed = cancelSmsBroadcastSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_sms_broadcast", {
    p_broadcast_id: parsed.data.broadcastId,
  });
  if (error) return mapPgError(error);

  revalidatePath("/admin/sms");
  return ok({ unsent: (data as { unsent: number }).unsent });
}
