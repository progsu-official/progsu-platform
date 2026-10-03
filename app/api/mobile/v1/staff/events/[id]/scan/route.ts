import { requireUser } from "@/lib/mobile/auth";
import { scanBody } from "@/lib/mobile/contracts";
import { ts } from "@/lib/mobile/data";
import { json, mobileRoute, pgError, rateLimit, readJson, uuidParam } from "@/lib/mobile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Idempotent by construction: event_attendances PK + on conflict in
// mobile_staff_scan; a repeat scan answers already_checked_in.
export const POST = mobileRoute("staff.scan", async ({ req, requestId, params }) => {
  const eventId = uuidParam(params.id);
  const auth = await requireUser(req);
  await rateLimit("scan", auth.user.id, 600, 600);
  const body = await readJson(req, scanBody);
  const { data, error } = await auth.supabase.rpc("mobile_staff_scan", { p_event_id: eventId, p_code: body.code });
  if (error) throw pgError(error);
  const r = (data ?? [])[0] as
    | { result: string; attendee_name: string | null; attendee_kind: string | null; points_awarded: number; checked_in_at: string | null }
    | undefined;
  if (!r) throw pgError(null);
  return json(
    {
      result: r.result,
      attendee: r.attendee_name
        ? { displayName: r.attendee_name, kind: (r.attendee_kind ?? "member") as "member" | "guest" }
        : null,
      pointsAwarded: Number(r.points_awarded ?? 0),
      checkedInAt: ts(r.checked_in_at),
    },
    requestId
  );
});
