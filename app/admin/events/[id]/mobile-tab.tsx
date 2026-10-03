import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adjustMemberPoints,
  grantEventStaff,
  revokeEventStaff,
  setEventPoints,
} from "@/lib/actions/mobile-admin";
import { createClient } from "@/lib/supabase/server";
import { isoToZonedLocal, zonedLocalToIso } from "@/lib/time-zone";

// Points rule + door-staff assignments for the iOS app. Staff here scan
// people in from the app with their own account (mobile_staff_scan); this is
// separate from the shared STAFF_CHECKIN_TOKEN web door at /checkin.

const ZONE = "America/New_York";

function back(eventId: string, msg: string, isError = false): never {
  const p = new URLSearchParams({ tab: "mobile", [isError ? "error" : "msg"]: msg });
  redirect(`/admin/events/${eventId}?${p.toString()}`);
}

export async function MobileTab({
  eventId,
  msg,
  error,
}: {
  eventId: string;
  msg?: string;
  error?: string;
}) {
  const supabase = await createClient();
  const [{ data: rule }, { data: staff, error: staffErr }] = await Promise.all([
    supabase.from("point_rules").select("points, rule_version").eq("event_id", eventId).maybeSingle(),
    supabase.rpc("admin_event_staff_for", { p_event_id: eventId }),
  ]);

  async function savePoints(fd: FormData) {
    "use server";
    const raw = String(fd.get("points") ?? "").trim();
    const res = await setEventPoints({ eventId, points: raw === "" ? null : Number(raw) });
    if (!res.ok) back(eventId, res.error.message, true);
    back(eventId, raw === "" ? "Points cleared." : `Attendance now earns ${raw} points.`);
  }

  async function grant(fd: FormData) {
    "use server";
    const local = String(fd.get("expiresAt") ?? "").trim();
    const res = await grantEventStaff({
      eventId,
      email: String(fd.get("email") ?? ""),
      expiresAt: local ? zonedLocalToIso(local, ZONE) : null,
    });
    if (!res.ok) back(eventId, res.error.message, true);
    back(eventId, "Staff access granted.");
  }

  async function revoke(fd: FormData) {
    "use server";
    const res = await revokeEventStaff(eventId, String(fd.get("userId") ?? ""));
    if (!res.ok) back(eventId, res.error.message, true);
    back(eventId, "Staff access revoked.");
  }

  async function adjust(fd: FormData) {
    "use server";
    const res = await adjustMemberPoints({
      email: String(fd.get("email") ?? ""),
      amount: Number(fd.get("amount") ?? 0),
      reason: String(fd.get("reason") ?? ""),
      eventId,
    });
    if (!res.ok) back(eventId, res.error.message, true);
    back(eventId, "Points adjusted.");
  }

  const staffRows = (staff ?? []) as Array<{
    user_id: string;
    name: string;
    email: string;
    expires_at: string | null;
  }>;

  return (
    <div className="space-y-8">
      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">{msg}</div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Attendance points</h2>
        <p className="text-sm text-muted-foreground">
          Awarded once per member when app staff scan or manually check them in. Self check-in and
          admin corrections award nothing. Removing a check-in reverses the award. Blank = no points.
        </p>
        <form action={savePoints} className="flex flex-wrap items-end gap-2">
          <Input
            name="points"
            type="number"
            min={0}
            max={10000}
            defaultValue={rule?.points ?? ""}
            className="w-32"
            aria-label="Points"
          />
          <Button type="submit">Save</Button>
          {rule ? (
            <span className="text-xs text-muted-foreground">rule v{rule.rule_version}</span>
          ) : null}
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Door staff (app)</h2>
        {staffErr ? <p className="text-sm text-destructive">{staffErr.message}</p> : null}
        <ul className="divide-y rounded-xl border">
          {staffRows.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">No staff assigned.</li>
          ) : (
            staffRows.map((s) => (
              <li key={s.user_id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  {s.name || s.email} <span className="text-muted-foreground">{s.email}</span>
                  {s.expires_at ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · until {isoToZonedLocal(s.expires_at, ZONE).replace("T", " ")}
                    </span>
                  ) : null}
                </span>
                <form action={revoke}>
                  <input type="hidden" name="userId" value={s.user_id} />
                  <Button type="submit" variant="outline" size="sm">
                    Revoke
                  </Button>
                </form>
              </li>
            ))
          )}
        </ul>
        <form action={grant} className="flex flex-wrap items-end gap-2">
          <Input name="email" type="email" required placeholder="member email" className="w-64" />
          <label className="text-xs text-muted-foreground">
            Expires (Atlanta time, optional)
            <Input name="expiresAt" type="datetime-local" className="w-56" />
          </label>
          <Button type="submit">Grant</Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Adjust a member&apos;s points</h2>
        <p className="text-sm text-muted-foreground">
          For prizes and corrections. Logged with your name and the reason.
        </p>
        <form action={adjust} className="flex flex-wrap items-end gap-2">
          <Input name="email" type="email" required placeholder="member email" className="w-64" />
          <Input name="amount" type="number" required min={-10000} max={10000} placeholder="±points" className="w-28" />
          <Input name="reason" required minLength={3} maxLength={500} placeholder="reason" className="w-72" />
          <Button type="submit">Adjust</Button>
        </form>
      </section>
    </div>
  );
}
