import { anonClient, optionalUser } from "@/lib/mobile/auth";
import { toEventDetail, ts } from "@/lib/mobile/data";
import { fail, json, mobileRoute, pgError } from "@/lib/mobile/http";
import { requireEventsOn } from "@/lib/mobile/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /events/{slug}
export const GET = mobileRoute("events.detail", async ({ req, requestId, params }) => {
  requireEventsOn();
  const slug = (params.ref ?? "").toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) fail("not_found", "Event not found.");
  const auth = await optionalUser(req);

  if (!auth) {
    const { data, error } = await anonClient().rpc("public_event_by_slug", { p_slug: slug });
    if (error) throw pgError(error);
    const row = (data ?? [])[0];
    if (!row) fail("not_found", "Event not found.");
    return json(await toEventDetail(anonClient(), row, null), requestId);
  }

  const { data: row, error } = await auth.supabase
    .from("member_visible_events")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw pgError(error);
  if (!row) fail("not_found", "Event not found.");

  const [rsvp, attendance, rule, ledger, staff] = await Promise.all([
    auth.supabase.from("event_rsvps").select("status").eq("event_id", row.id).eq("user_id", auth.user.id).maybeSingle(),
    auth.supabase.from("event_attendances").select("checked_in_at").eq("event_id", row.id).eq("user_id", auth.user.id).maybeSingle(),
    auth.supabase.from("point_rules").select("points").eq("event_id", row.id).maybeSingle(),
    auth.supabase.from("point_ledger").select("amount").eq("event_id", row.id).eq("user_id", auth.user.id),
    auth.supabase.rpc("is_active_event_staff", { p_event_id: row.id, p_user_id: auth.user.id }),
  ]);

  return json(
    await toEventDetail(auth.supabase, row, {
      rsvpStatus: (rsvp.data?.status as "going" | "waitlisted" | "declined" | "cancelled" | undefined) ?? null,
      checkedInAt: ts(attendance.data?.checked_in_at as string | undefined),
      pointsAvailable: (rule.data?.points as number | null | undefined) ?? null,
      pointsEarned: (ledger.data ?? []).reduce((s, r) => s + Number(r.amount), 0),
      isStaff: staff.data === true,
    }),
    requestId
  );
});
