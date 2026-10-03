import { NextResponse } from "next/server";

import { requireUser } from "@/lib/mobile/auth";
import { fail, mobileRoute, pgError, rateLimit, uuidParam } from "@/lib/mobile/http";
import { buildEventPass, walletConfigured } from "@/lib/mobile/wallet";
import { requireEventsOn } from "@/lib/mobile/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("me.wallet", async ({ req, requestId, params }) => {
  requireEventsOn();
  const eventId = uuidParam(params.id);
  const auth = await requireUser(req);
  await rateLimit("pass", auth.user.id, 20, 3600);
  if (!walletConfigured()) fail("unavailable", "Wallet passes are not available yet.");

  const [{ data: event, error: evErr }, { data: profile }] = await Promise.all([
    auth.supabase.from("events").select("title, starts_at, ends_at, location_text, status").eq("id", eventId).maybeSingle(),
    auth.supabase.from("profiles").select("preferred_name, first_name").eq("id", auth.user.id).single(),
  ]);
  if (evErr) throw pgError(evErr);
  if (!event || event.status !== "published") fail("not_found", "Event not found.");

  const { data: issued, error } = await auth.supabase.rpc("issue_event_pass", { p_event_id: eventId });
  if (error) throw pgError(error);
  const row = (issued ?? [])[0] as { token: string; serial: string } | undefined;
  if (!row) fail("internal", "Could not issue pass.");

  const buf = buildEventPass({
    serial: row.serial,
    token: row.token,
    eventTitle: String(event.title),
    startsAt: new Date(event.starts_at as string).toISOString(),
    endsAt: new Date(event.ends_at as string).toISOString(),
    locationText: (event.location_text as string | null) ?? null,
    attendeeFirstName: (profile?.preferred_name || profile?.first_name || null) as string | null,
  });
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="progsu-${eventId.slice(0, 8)}.pkpass"`,
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
});
