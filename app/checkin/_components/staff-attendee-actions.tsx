"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { staffCheckInByToken, staffCheckInMember } from "@/lib/actions/checkin";
import { AttendeeTable, type AttendeeRow } from "@/app/admin/events/[id]/_components/attendee-table";

// Staff-token trust model, not an admin session, so actions here stay to
// check-in only — no remove/promote (those stay admin-only in guests-tab.tsx).
// Members check in by user_id via staffCheckInMember (no ticket needed);
// guests reuse the same staffCheckInByToken the QR scanner calls, now that
// staffEventAttendees also returns their checkin_token.
export function StaffAttendeeSection({
  eventId,
  rows,
}: {
  eventId: string;
  rows: AttendeeRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(
    fn: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>
  ) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error.message);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      <AttendeeTable
        rows={rows}
        renderActions={(r) => {
          if (r.checkedIn) {
            return <span className="text-xs text-muted-foreground">Checked in</span>;
          }
          if (r.kind === "member") {
            return (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => run(() => staffCheckInMember(eventId, r.id))}
              >
                Check in
              </Button>
            );
          }
          // Guest: only checkable while 'going' (checkinToken set) — a
          // waitlisted/cancelled guest has no ticket to redeem, same
          // restriction the admin Attendees tab already has.
          if (r.checkinToken) {
            return (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => staffCheckInByToken(r.checkinToken as string, eventId))
                }
              >
                Check in
              </Button>
            );
          }
          return <span className="text-xs text-muted-foreground">—</span>;
        }}
      />
    </div>
  );
}
