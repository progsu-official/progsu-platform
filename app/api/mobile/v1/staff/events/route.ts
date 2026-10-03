import { requireUser } from "@/lib/mobile/auth";
import { ts } from "@/lib/mobile/data";
import { json, mobileRoute, pgError } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("staff.events", async ({ req, requestId }) => {
  const auth = await requireUser(req);
  const { data, error } = await auth.supabase.rpc("mobile_staff_events");
  if (error) throw pgError(error);
  return json(
    {
      items: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.event_id),
        slug: String(r.slug),
        title: String(r.title),
        startsAt: ts(r.starts_at as string),
        endsAt: ts(r.ends_at as string),
        status: String(r.status),
        assignmentExpiresAt: ts(r.expires_at as string | null),
        goingCount: Number(r.going ?? 0),
        checkedInCount: Number(r.checked_in ?? 0),
      })),
    },
    requestId
  );
});
