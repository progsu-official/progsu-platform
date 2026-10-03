import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireCronSecret } from "@/lib/env";
import { log } from "@/lib/log";
import { runPushOutbox } from "@/lib/mobile/apns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  let expected: string;
  try {
    expected = `Bearer ${requireCronSecret()}`;
  } catch {
    return false;
  }
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const result = await runPushOutbox({ maxBatch: 200 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error("push-outbox cron failed", {
      action: "cron_push_outbox",
      error_message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "push worker failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
