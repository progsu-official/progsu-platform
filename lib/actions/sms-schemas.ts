import { z } from "zod";

// Kept out of the "use server" module so the composer can import the types
// and share the same validation messages. The database re-checks every one of
// these in create_sms_broadcast(); this is the message a human reads first.

export const SMS_BODY_MAX = 480;

export const smsBodySchema = z
  .string()
  .trim()
  .min(1, "Write a message first")
  .max(SMS_BODY_MAX, `Keep it to ${SMS_BODY_MAX} characters or fewer`)
  .regex(/\bstop\b/i, 'Every text has to say how to opt out, e.g. "Reply STOP to opt out."');

export const smsAudienceSchema = z.enum(["gsu", "all_consented", "hacklanta_accepted"]);
export type SmsAudience = z.infer<typeof smsAudienceSchema>;

export const SMS_BATCH_MAX = 1000;

export const createSmsBroadcastSchema = z
  .object({
    body: smsBodySchema,
    audience: smsAudienceSchema,
    // The count the officer confirmed. The database refuses the send if the
    // audience has changed size since.
    expectedCount: z.number().int().positive(),
    // Hacklanta only: text the next batchSize people not texted yet,
    // optionally only those whose acceptance email has gone out.
    batchSize: z
      .number()
      .int()
      .min(1, "Batch size must be at least 1")
      .max(SMS_BATCH_MAX, `Keep a batch to ${SMS_BATCH_MAX} or fewer`)
      .optional(),
    emailedOnly: z.boolean().optional(),
  })
  .refine((v) => v.audience === "hacklanta_accepted" || (v.batchSize == null && !v.emailedOnly), {
    message: "Batches are only for the Hacklanta audience",
    path: ["batchSize"],
  });

// hacklanta_sms_progress(): one row per usable number among accepted applicants.
export type HacklantaProgress = {
  numbers: number;
  emailed: number;
  texted: number;
  delivered: number;
  failed: number;
  opted_out: number;
  left: number;
  left_emailed: number;
};

// From the Hacklanta II database on this page load (lib/sms/hacklanta-sync.ts).
export type HacklantaRoster = {
  accepted: number;
  skippedInvalid: number;
  emailedNoNumber: number;
};

export const sendSmsTestSchema = z.object({
  body: smsBodySchema,
});

export const cancelSmsBroadcastSchema = z.object({
  broadcastId: z.string().uuid(),
});

export const setEventSmsReminderSchema = z.object({
  eventId: z.string().uuid(),
  enabled: z.boolean(),
});

export type SmsUpcomingReminder = {
  id: string;
  title: string;
  slug: string;
  location_text: string | null;
  starts_at: string;
  send_sms_reminder: boolean;
  sms_reminder_sent_at: string | null;
  recipient_count: number;
};

export type SmsDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "suppressed"
  | "skipped"
  | "cancelled";

export type SmsBroadcastRow = {
  id: string;
  body: string;
  audience: SmsAudience | "self_test" | "event_reminder";
  status: "sending" | "done" | "cancelled";
  recipient_count: number;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  event_id: string | null;
  event_title: string | null;
  created_by_name: string;
  counts: Partial<Record<SmsDeliveryStatus, number>>;
  error_codes: Record<string, number>;
};

export type SmsOverview = {
  audiences: Record<SmsAudience, number>;
  hacklanta: HacklantaProgress | null;
  hacklantaRoster: HacklantaRoster | null;
  suppressed: number;
  self: {
    has_phone: boolean;
    phone_last4: string | null;
    is_suppressed: boolean;
    first_name?: string | null;
  };
  broadcasts: SmsBroadcastRow[];
  upcomingReminders: SmsUpcomingReminder[];
  config: {
    canSend: boolean;
    receipts: boolean;
    eventReminders: boolean;
    hacklantaSyncError: string | null;
  };
  siteUrl: string;
};
