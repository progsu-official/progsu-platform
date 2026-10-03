import { requireUser } from "@/lib/mobile/auth";
import { ts } from "@/lib/mobile/data";
import { json, mobileRoute, pgError, rateLimit, uuidParam } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = mobileRoute("staff.roster", async ({ req, requestId, params }) => {
  const eventId = uuidParam(params.id);
  const auth = await requireUser(req);
  await rateLimit("roster", auth.user.id, 300, 600);
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const { data, error } = await auth.supabase.rpc("mobile_staff_roster", { p_event_id: eventId, p_query: q || null });
  if (error) throw pgError(error);
  return json(
    {
      items: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        userId: String(r.user_id),
        displayName: String(r.display_name ?? ""),
        rsvpStatus: r.rsvp_status as "going" | "waitlisted",
        checkedIn: Boolean(r.checked_in),
        checkedInAt: ts(r.checked_in_at as string | null),
      })),
    },
    requestId
  );
});
