import "server-only";

import EventCancellationEmail, {
  eventCancellationPlainText,
} from "@/emails/EventCancellationEmail";
import EventReminderEmail, {
  eventReminderPlainText,
} from "@/emails/EventReminderEmail";
import EventRsvpConfirmationEmail, {
  eventRsvpConfirmationPlainText,
} from "@/emails/EventRsvpConfirmationEmail";
import GuestRsvpConfirmationEmail, {
  guestRsvpConfirmationPlainText,
} from "@/emails/GuestRsvpConfirmationEmail";
import { env } from "@/lib/env";
import { sendEmail, type SendEmailResult } from "@/lib/email/resend";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Event transactional email helpers.
//
// Scope: RSVP confirmation (inline), reminder fan-out (queued), cancellation
// fan-out (queued), and the cron worker that drains event_notification_jobs.
//
// All server entry points (caller routes + the worker) use the service-role
// Supabase client. The enqueue/claim/finish/mark RPCs are service_role-gated
// (see migration 20260423000400).
// ---------------------------------------------------------------------------

export type EventNotificationKind = "confirmation" | "reminder" | "cancellation";

type AdminClient = ReturnType<typeof createAdminClient>;

type EventRow = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  location_url: string | null;
  status: string;
  cancellation_reason: string | null;
  send_rsvp_email: boolean;
};

type ProfileRow = {
  id: string;
  google_email: string;
  first_name: string | null;
  preferred_name: string | null;
};

type ClaimedJobRow = {
  id: string;
  event_id: string;
  kind: EventNotificationKind;
  user_id: string | null;
  scheduled_for: string;
  status: string;
  attempts: number;
  dedupe_key: string | null;
  created_at: string;
};

function eventUrlFor(slug: string): string {
  const base = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  return `${base}/events/${slug}`;
}

export function guestTicketUrlFor(token: string): string {
  const base = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  return `${base}/tickets/${token}`;
}

function memberNameFor(profile: ProfileRow): string {
  const name =
    profile.preferred_name?.trim() || profile.first_name?.trim() || null;
  return name ?? "there";
}

async function fetchEvent(
  admin: AdminClient,
  eventId: string
): Promise<EventRow | null> {
  const { data, error } = await admin
    .from("events")
    .select(
      "id, slug, title, starts_at, ends_at, location_text, location_url, status, cancellation_reason, send_rsvp_email"
    )
    .eq("id", eventId)
    .maybeSingle<EventRow>();
  if (error) {
    log.warn("events email: fetch event failed", {
      action: "event_email_fetch_event",
      event_id: eventId,
      error_message: error.message,
    });
    return null;
  }
  return data;
}

async function fetchProfile(
  admin: AdminClient,
  userId: string
): Promise<ProfileRow | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, google_email, first_name, preferred_name")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  if (error) {
    log.warn("events email: fetch profile failed", {
      action: "event_email_fetch_profile",
      user_id: userId,
      error_message: error.message,
    });
    return null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// sendEventRsvpConfirmation — inline send for the RSVP 'going' confirmation.
// Also writes an audit row to event_notification_jobs (kind=confirmation,
// status=sent) so we keep a durable record of the confirmation send.
// ---------------------------------------------------------------------------
export async function sendEventRsvpConfirmation({
  eventId,
  userId,
}: {
  eventId: string;
  userId: string;
}): Promise<SendEmailResult> {
  const admin = createAdminClient();

  const [event, profile] = await Promise.all([
    fetchEvent(admin, eventId),
    fetchProfile(admin, userId),
  ]);

  if (!event) {
    return {
      ok: false,
      code: "CONFIG_ERROR",
      message: `event ${eventId} not found`,
    };
  }
  if (!profile) {
    return {
      ok: false,
      code: "CONFIG_ERROR",
      message: `profile ${userId} not found`,
    };
  }

  const startsAt = new Date(event.starts_at);
  const eventUrl = eventUrlFor(event.slug);
  const memberName = memberNameFor(profile);
  const location = event.location_text;
  const dedupeKey = `event-rsvp-confirm:${eventId}:${userId}`;

  const subject = `You're going: ${event.title}`;
  const react = EventRsvpConfirmationEmail({
    memberName,
    eventTitle: event.title,
    startsAt,
    location,
    eventUrl,
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
  });
  const text = eventRsvpConfirmationPlainText({
    memberName,
    eventTitle: event.title,
    startsAt,
    location,
    eventUrl,
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
  });

  const sendResult = await sendEmail({
    to: profile.google_email,
    subject,
    react,
    text,
    idempotencyKey: dedupeKey,
    tags: {
      kind: "event_rsvp_confirmation",
      event_id: eventId,
    },
  });

  // Audit row — write regardless of outcome, but only mark status='sent' on
  // success. Use the enqueue RPC so the dedupe key still deduplicates if this
  // helper fires twice for the same (event,user). The RPC accepts service_role.
  try {
    const { data: jobId, error: enqErr } = await admin.rpc(
      "enqueue_event_notification",
      {
        p_event_id: eventId,
        p_kind: "confirmation",
        p_user_id: userId,
        p_scheduled_for: new Date().toISOString(),
        p_dedupe_key: dedupeKey,
      }
    );
    if (enqErr || typeof jobId !== "string") {
      log.warn("event confirmation: audit enqueue failed", {
        action: "event_email_confirmation_audit",
        event_id: eventId,
        user_id: userId,
        error_message: enqErr?.message,
      });
    } else if (sendResult.ok) {
      const { error: finErr } = await admin.rpc(
        "finish_event_notification_job",
        { p_id: jobId, p_status: "sent" }
      );
      if (finErr) {
        log.warn("event confirmation: finish(sent) failed", {
          action: "event_email_confirmation_audit",
          event_id: eventId,
          user_id: userId,
          error_message: finErr.message,
        });
      }
    } else {
      const { error: finErr } = await admin.rpc(
        "finish_event_notification_job",
        {
          p_id: jobId,
          p_status: "failed",
          p_error: `${sendResult.code}: ${sendResult.message}`.slice(0, 2000),
        }
      );
      if (finErr) {
        log.warn("event confirmation: finish(failed) failed", {
          action: "event_email_confirmation_audit",
          event_id: eventId,
          user_id: userId,
          error_message: finErr.message,
        });
      }
    }
  } catch (auditErr) {
    log.warn("event confirmation: audit path threw", {
      action: "event_email_confirmation_audit",
      event_id: eventId,
      user_id: userId,
      error_message:
        auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }

  log.info("event rsvp confirmation send", {
    action: "send_event_rsvp_confirmation",
    event_id: eventId,
    user_id: userId,
    ok: sendResult.ok,
    transport: sendResult.ok ? sendResult.transport : undefined,
    error_code: !sendResult.ok ? sendResult.code : undefined,
  });

  return sendResult;
}

// ---------------------------------------------------------------------------
// sendGuestRsvpConfirmation — inline send for an account-free guest
// registration (2026-08-21 guest-ticket decision).
//
// Takes only (eventId, guestEmail): the guest's display name and check-in
// token are read from event_guest_rsvps here rather than passed in, so the
// email can never disagree with the row the RPC just wrote.
//
// Durable record goes to audit_log, not event_notification_jobs — that table's
// user_id FKs auth.users and a guest has no auth identity, so an enqueued
// guest job would be a row the worker can only ever mark failed.
// ---------------------------------------------------------------------------
export async function sendGuestRsvpConfirmation({
  eventId,
  guestEmail,
}: {
  eventId: string;
  guestEmail: string;
}): Promise<SendEmailResult> {
  const admin = createAdminClient();

  type GuestRow = { name: string; checkin_token: string | null };
  const [event, guestRes] = await Promise.all([
    fetchEvent(admin, eventId),
    admin
      .from("event_guest_rsvps")
      .select("name, checkin_token")
      .eq("event_id", eventId)
      .eq("email", guestEmail)
      .maybeSingle<GuestRow>(),
  ]);

  if (!event) {
    return {
      ok: false,
      code: "CONFIG_ERROR",
      message: `event ${eventId} not found`,
    };
  }
  if (guestRes.error || !guestRes.data) {
    return {
      ok: false,
      code: "CONFIG_ERROR",
      message: `guest rsvp not found for event ${eventId}: ${guestRes.error?.message ?? "no row"}`,
    };
  }
  // The caller is an anon server action and can't read `events` itself, so the
  // opt-out flag is enforced here instead of at the call site (the member path
  // checks it in rsvpToEvent, where a user-context read is available).
  if (!event.send_rsvp_email) {
    return {
      ok: false,
      code: "CONFIG_ERROR",
      message: `event ${eventId} has send_rsvp_email = false`,
    };
  }
  const guest = guestRes.data;
  if (!guest.checkin_token) {
    // Only a 'going' row carries a token. A waitlisted guest has no ticket to
    // link to yet, so there is no confirmation to send.
    return {
      ok: false,
      code: "CONFIG_ERROR",
      message: `guest rsvp for event ${eventId} has no checkin_token`,
    };
  }

  const eventUrl = eventUrlFor(event.slug);
  const ticketUrl = guestTicketUrlFor(guest.checkin_token);
  const props = {
    guestName: guest.name,
    eventTitle: event.title,
    startsAt: new Date(event.starts_at),
    endsAt: new Date(event.ends_at),
    location: event.location_text,
    eventUrl,
    ticketUrl,
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
  };

  const sendResult = await sendEmail({
    to: guestEmail,
    subject: `You're registered: ${event.title}`,
    react: GuestRsvpConfirmationEmail(props),
    text: guestRsvpConfirmationPlainText(props),
    idempotencyKey: `guest-rsvp-confirm:${eventId}:${guestEmail}`,
    tags: { kind: "guest_rsvp_confirmation", event_id: eventId },
  });

  // Best-effort audit. A failed audit write must not turn a delivered email
  // into a reported failure, so the result is logged and dropped.
  const { error: auditErr } = await admin.rpc("write_audit", {
    p_action: "event.guest_confirmation_email",
    p_actor: null,
    p_target: null,
    p_metadata: {
      event_id: eventId,
      email: guestEmail,
      event_url: eventUrl,
      ticket_url: ticketUrl,
      ok: sendResult.ok,
      error_code: sendResult.ok ? null : sendResult.code,
    },
  });
  if (auditErr) {
    log.warn("guest confirmation: audit write failed", {
      action: "send_guest_rsvp_confirmation",
      event_id: eventId,
      error_message: auditErr.message,
    });
  }

  log.info("guest rsvp confirmation send", {
    action: "send_guest_rsvp_confirmation",
    event_id: eventId,
    ok: sendResult.ok,
    transport: sendResult.ok ? sendResult.transport : undefined,
    error_code: !sendResult.ok ? sendResult.code : undefined,
  });

  return sendResult;
}

// ---------------------------------------------------------------------------
// enqueueEventReminder — queue a reminder for every current going RSVP.
// scheduled_for defaults to max(now+5min, starts_at - 24h) so we don't queue
// in the past; if the event is imminent, the worker picks it up on the next tick.
// ---------------------------------------------------------------------------
export async function enqueueEventReminder({
  eventId,
  scheduledFor,
}: {
  eventId: string;
  scheduledFor?: Date;
}): Promise<{ enqueuedCount: number }> {
  const admin = createAdminClient();

  const event = await fetchEvent(admin, eventId);
  if (!event) {
    log.warn("enqueue reminder: event not found", {
      action: "enqueue_event_reminder",
      event_id: eventId,
    });
    return { enqueuedCount: 0 };
  }

  const now = Date.now();
  const startsAtMs = new Date(event.starts_at).getTime();
  const earliest = now + 5 * 60 * 1000; // 5 min cushion
  const defaultReminder = startsAtMs - 24 * 60 * 60 * 1000;
  const resolvedAt =
    scheduledFor ?? new Date(Math.max(earliest, defaultReminder));
  const scheduledIso = resolvedAt.toISOString();

  type RsvpRow = { user_id: string };
  const { data: rsvps, error } = await admin
    .from("event_rsvps")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("status", "going")
    .returns<RsvpRow[]>();
  if (error) {
    log.warn("enqueue reminder: fetch rsvps failed", {
      action: "enqueue_event_reminder",
      event_id: eventId,
      error_message: error.message,
    });
    return { enqueuedCount: 0 };
  }

  let enqueued = 0;
  for (const r of rsvps ?? []) {
    const dedupeKey = `reminder:${eventId}:${r.user_id}`;
    const { error: enqErr } = await admin.rpc("enqueue_event_notification", {
      p_event_id: eventId,
      p_kind: "reminder",
      p_user_id: r.user_id,
      p_scheduled_for: scheduledIso,
      p_dedupe_key: dedupeKey,
    });
    if (enqErr) {
      log.warn("enqueue reminder: enqueue_event_notification failed", {
        action: "enqueue_event_reminder",
        event_id: eventId,
        user_id: r.user_id,
        error_message: enqErr.message,
      });
      continue;
    }
    enqueued += 1;
  }

  log.info("event reminder enqueued", {
    action: "enqueue_event_reminder",
    event_id: eventId,
    ok: true,
    enqueued_count: enqueued,
    rsvp_count: rsvps?.length ?? 0,
  });
  return { enqueuedCount: enqueued };
}

// ---------------------------------------------------------------------------
// enqueueEventCancellation — queue a cancellation email for every member
// with a going/waitlisted RSVP or an event_attendances row.
// ---------------------------------------------------------------------------
export async function enqueueEventCancellation({
  eventId,
}: {
  eventId: string;
}): Promise<{ enqueuedCount: number }> {
  const admin = createAdminClient();

  type Row = { user_id: string };
  const [rsvpRes, attendRes] = await Promise.all([
    admin
      .from("event_rsvps")
      .select("user_id")
      .eq("event_id", eventId)
      .in("status", ["going", "waitlisted"])
      .returns<Row[]>(),
    admin
      .from("event_attendances")
      .select("user_id")
      .eq("event_id", eventId)
      .returns<Row[]>(),
  ]);

  if (rsvpRes.error) {
    log.warn("enqueue cancellation: fetch rsvps failed", {
      action: "enqueue_event_cancellation",
      event_id: eventId,
      error_message: rsvpRes.error.message,
    });
  }
  if (attendRes.error) {
    log.warn("enqueue cancellation: fetch attendances failed", {
      action: "enqueue_event_cancellation",
      event_id: eventId,
      error_message: attendRes.error.message,
    });
  }

  const userIds = new Set<string>();
  for (const row of rsvpRes.data ?? []) userIds.add(row.user_id);
  for (const row of attendRes.data ?? []) userIds.add(row.user_id);

  const nowIso = new Date().toISOString();
  let enqueued = 0;
  for (const userId of userIds) {
    const dedupeKey = `cancellation:${eventId}:${userId}`;
    const { error: enqErr } = await admin.rpc("enqueue_event_notification", {
      p_event_id: eventId,
      p_kind: "cancellation",
      p_user_id: userId,
      p_scheduled_for: nowIso,
      p_dedupe_key: dedupeKey,
    });
    if (enqErr) {
      log.warn("enqueue cancellation: enqueue_event_notification failed", {
        action: "enqueue_event_cancellation",
        event_id: eventId,
        user_id: userId,
        error_message: enqErr.message,
      });
      continue;
    }
    enqueued += 1;
  }

  log.info("event cancellation enqueued", {
    action: "enqueue_event_cancellation",
    event_id: eventId,
    ok: true,
    enqueued_count: enqueued,
    recipient_count: userIds.size,
  });
  return { enqueuedCount: enqueued };
}

// ---------------------------------------------------------------------------
// runEventNotificationWorker — cron worker. Claims a batch, renders+sends each
// email based on kind+user_id, finalises the job. Never throws — bad rows are
// marked failed and the batch continues. Calls mark_event_reminder_sent after
// each successful reminder send (idempotent by virtue of its WHERE clause).
// ---------------------------------------------------------------------------
export async function runEventNotificationWorker({
  maxBatch = 100,
}: {
  maxBatch?: number;
} = {}): Promise<{ processed: number; sent: number; failed: number }> {
  const admin = createAdminClient();

  const { data: claimedRaw, error: claimErr } = await admin.rpc(
    "claim_event_notification_jobs",
    { p_limit: maxBatch }
  );
  if (claimErr) {
    log.error("event worker: claim failed", {
      action: "event_notification_worker",
      error_message: claimErr.message,
    });
    return { processed: 0, sent: 0, failed: 0 };
  }

  const claimed = (claimedRaw ?? []) as ClaimedJobRow[];
  let sent = 0;
  let failed = 0;

  for (const job of claimed) {
    try {
      const result = await processJob(admin, job);
      if (result.status === "sent") {
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      log.error("event worker: per-row threw", {
        action: "event_notification_worker",
        event_id: job.event_id,
        user_id: job.user_id ?? undefined,
        kind: job.kind,
        error_message: message,
      });
      // Best-effort finalisation so we don't leave the job stuck in_flight.
      try {
        const { error: finErr } = await admin.rpc(
          "finish_event_notification_job",
          {
            p_id: job.id,
            p_status: "failed",
            p_error: message.slice(0, 2000),
          }
        );
        if (finErr) {
          log.error("event worker: finish(failed) after throw failed", {
            action: "event_notification_worker",
            job_id: job.id,
            error_message: finErr.message,
          });
        }
      } catch (finThrow) {
        log.error("event worker: finish(failed) after throw threw", {
          action: "event_notification_worker",
          job_id: job.id,
          error_message:
            finThrow instanceof Error ? finThrow.message : String(finThrow),
        });
      }
    }
  }

  log.info("event worker drain", {
    action: "event_notification_worker",
    ok: true,
    processed: claimed.length,
    sent,
    failed,
  });
  return { processed: claimed.length, sent, failed };
}

async function processJob(
  admin: AdminClient,
  job: ClaimedJobRow
): Promise<{ status: "sent" | "failed"; message?: string }> {
  if (!job.user_id) {
    await finish(admin, job.id, "failed", "missing user_id on job");
    return { status: "failed", message: "missing user_id" };
  }

  const [event, profile] = await Promise.all([
    fetchEvent(admin, job.event_id),
    fetchProfile(admin, job.user_id),
  ]);
  if (!event) {
    await finish(admin, job.id, "failed", `event ${job.event_id} not found`);
    return { status: "failed", message: "event not found" };
  }
  if (!profile) {
    await finish(admin, job.id, "failed", `profile ${job.user_id} not found`);
    return { status: "failed", message: "profile not found" };
  }

  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  const eventUrl = eventUrlFor(event.slug);
  const memberName = memberNameFor(profile);
  const startsAt = new Date(event.starts_at);

  let subject: string;
  let react: React.ReactElement;
  let text: string;
  let tagKind: string;

  if (job.kind === "reminder") {
    subject = `Tomorrow: ${event.title}`;
    tagKind = "event_reminder";
    react = EventReminderEmail({
      memberName,
      eventTitle: event.title,
      startsAt,
      location: event.location_text,
      eventUrl,
      siteUrl,
    });
    text = eventReminderPlainText({
      memberName,
      eventTitle: event.title,
      startsAt,
      location: event.location_text,
      eventUrl,
      siteUrl,
    });
  } else if (job.kind === "cancellation") {
    subject = `Cancelled: ${event.title}`;
    tagKind = "event_cancellation";
    react = EventCancellationEmail({
      memberName,
      eventTitle: event.title,
      originalStartsAt: startsAt,
      cancellationReason: event.cancellation_reason,
      siteUrl,
    });
    text = eventCancellationPlainText({
      memberName,
      eventTitle: event.title,
      originalStartsAt: startsAt,
      cancellationReason: event.cancellation_reason,
      siteUrl,
    });
  } else if (job.kind === "confirmation") {
    // Confirmations are sent inline. A queued confirmation row either arrived
    // from the inline helper (already marked sent there) or was enqueued
    // directly. Handle it by sending the confirmation email.
    subject = `You're going: ${event.title}`;
    tagKind = "event_rsvp_confirmation";
    react = EventRsvpConfirmationEmail({
      memberName,
      eventTitle: event.title,
      startsAt,
      location: event.location_text,
      eventUrl,
      siteUrl,
    });
    text = eventRsvpConfirmationPlainText({
      memberName,
      eventTitle: event.title,
      startsAt,
      location: event.location_text,
      eventUrl,
      siteUrl,
    });
  } else {
    await finish(admin, job.id, "failed", `unknown kind: ${String(job.kind)}`);
    return { status: "failed", message: "unknown kind" };
  }

  const sendResult = await sendEmail({
    to: profile.google_email,
    subject,
    react,
    text,
    idempotencyKey: job.dedupe_key ?? `job:${job.id}`,
    tags: { kind: tagKind, event_id: job.event_id },
  });

  if (!sendResult.ok) {
    const msg = `${sendResult.code}: ${sendResult.message}`;
    await finish(admin, job.id, "failed", msg);
    log.warn("event worker: send failed", {
      action: "event_notification_worker",
      job_id: job.id,
      event_id: job.event_id,
      kind: job.kind,
      error_code: sendResult.code,
    });
    return { status: "failed", message: msg };
  }

  await finish(admin, job.id, "sent");

  if (job.kind === "reminder") {
    // Idempotent by virtue of the RPC's own WHERE reminder_sent_at IS NULL.
    const { error: markErr } = await admin.rpc("mark_event_reminder_sent", {
      p_event_id: job.event_id,
    });
    if (markErr) {
      log.warn("event worker: mark_event_reminder_sent failed", {
        action: "event_notification_worker",
        event_id: job.event_id,
        error_message: markErr.message,
      });
    }
  }

  return { status: "sent" };
}

async function finish(
  admin: AdminClient,
  jobId: string,
  status: "sent" | "failed",
  errorText?: string
): Promise<void> {
  const { error } = await admin.rpc("finish_event_notification_job", {
    p_id: jobId,
    p_status: status,
    p_error: errorText ? errorText.slice(0, 2000) : null,
  });
  if (error) {
    log.warn("event worker: finish rpc failed", {
      action: "event_notification_worker",
      job_id: jobId,
      status,
      error_message: error.message,
    });
  }
}
