import { NextResponse, type NextRequest } from "next/server";

import { enqueueEventReminder } from "@/lib/email/events";
import { requireCronSecret } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Cron-driven reminder enqueuer. Finds published, reminder-eligible events
// whose start is 20–30h out and whose reminder_sent_at is still null, then
// calls enqueueEventReminder(...) for each. The worker route drains the jobs.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  let expected: string;
  try {
    expected = `Bearer ${requireCronSecret()}`;
  } catch {
    return false;
  }
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i += 1) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

type CandidateEventRow = {
  id: string;
  starts_at: string;
};

async function handle(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const admin = createAdminClient();

  const now = new Date();
  const from = new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 30 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await admin
    .from("events")
    .select("id, starts_at")
    .eq("status", "published")
    .eq("send_reminder_email", true)
    .is("reminder_sent_at", null)
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at", { ascending: true })
    .returns<CandidateEventRow[]>();

  if (error) {
    log.error("event-reminders cron: scan failed", {
      action: "cron_event_reminders",
      error_message: error.message,
    });
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const remindersEnqueuedByEvent: Record<string, number> = {};
  for (const ev of events ?? []) {
    try {
      const { enqueuedCount } = await enqueueEventReminder({ eventId: ev.id });
      remindersEnqueuedByEvent[ev.id] = enqueuedCount;
    } catch (err) {
      log.error("event-reminders cron: enqueue threw", {
        action: "cron_event_reminders",
        event_id: ev.id,
        error_message: err instanceof Error ? err.message : String(err),
      });
      remindersEnqueuedByEvent[ev.id] = 0;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      eventsScanned: events?.length ?? 0,
      remindersEnqueuedByEvent,
    },
    { status: 200 }
  );
}

// Vercel Cron calls GET; external schedulers / manual tests can use POST.
export const GET = handle;
export const POST = handle;
