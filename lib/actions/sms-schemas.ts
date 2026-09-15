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

export const smsAudienceSchema = z.enum(["gsu", "all_consented"]);
export type SmsAudience = z.infer<typeof smsAudienceSchema>;

export const createSmsBroadcastSchema = z.object({
  body: smsBodySchema,
  audience: smsAudienceSchema,
  // The count the officer confirmed. The database refuses the send if the
  // audience has changed size since.
  expectedCount: z.number().int().positive(),
});

export const sendSmsTestSchema = z.object({
  body: smsBodySchema,
});

export const cancelSmsBroadcastSchema = z.object({
  broadcastId: z.string().uuid(),
});

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
  audience: SmsAudience | "self_test";
  status: "sending" | "done" | "cancelled";
  recipient_count: number;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  created_by_name: string;
  counts: Partial<Record<SmsDeliveryStatus, number>>;
  error_codes: Record<string, number>;
};

export type SmsOverview = {
  audiences: Record<SmsAudience, number>;
  suppressed: number;
  self: { has_phone: boolean; phone_last4: string | null; is_suppressed: boolean };
  broadcasts: SmsBroadcastRow[];
  config: { canSend: boolean; receipts: boolean };
};
