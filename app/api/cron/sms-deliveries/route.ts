import { NextResponse, type NextRequest } from "next/server";

import { requireCronSecret } from "@/lib/env";
import { log } from "@/lib/log";
import { runSmsDeliveryWorker } from "@/lib/sms/worker";

// Per-minute drain of sms_deliveries. The server action that creates a
// broadcast already kicks the worker once; this is what finishes a broadcast
// too large for one pass and picks up anything a crashed pass left queued.
// Same shared-bearer auth as event-notifications/route.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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

async function handle(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runSmsDeliveryWorker();
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("sms-deliveries cron failed", {
      action: "cron_sms_deliveries",
      error_message: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Vercel Cron calls GET; external schedulers / manual tests can use POST.
export const GET = handle;
export const POST = handle;
