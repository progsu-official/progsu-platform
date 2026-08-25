import { NextResponse, type NextRequest } from "next/server";

import { requireCronSecret } from "@/lib/env";
import { log } from "@/lib/log";
import { runDailyRecap } from "@/lib/discord/run-recap";

// Daily Discord recap. Same shared-bearer auth as the other cron routes; see
// event-notifications/route.ts for the constant-time compare this copies.
//
// nodejs runtime and a raised maxDuration because rendering the chart through
// next/og costs real CPU — a few hundred milliseconds, but well past what the
// default gives a route that also makes a dozen database round trips.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

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
    const result = await runDailyRecap();
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("discord-recap cron failed", {
      action: "cron_discord_recap",
      error_message: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
