import { NextResponse, type NextRequest } from "next/server";

import { requireCronSecret } from "@/lib/env";
import { log } from "@/lib/log";
import { runEventNotificationWorker } from "@/lib/email/events";

// Cron-driven drain of the event_notification_jobs queue. Auth is a shared
// static bearer token (Vercel Cron / external scheduler posts with it). The
// worker runs against the service-role Supabase client so it can call the
// service_role-gated claim/finish RPCs.

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
  // Constant-ish compare — lengths must match first.
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i += 1) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function handle(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runEventNotificationWorker({ maxBatch: 100 });
    return NextResponse.json(
      { ok: true, ...result },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("event-notifications cron failed", {
      action: "cron_event_notifications",
      error_message: message,
    });
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

// Vercel Cron calls GET; external schedulers / manual tests can use POST.
export const GET = handle;
export const POST = handle;
