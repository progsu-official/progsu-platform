"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  adminCheckIn,
  correctAttendance,
  promoteWaitlistedMember,
} from "@/lib/actions/events";

import type { RosterRow } from "./types";

export function GuestsTab({
  eventId,
  rows,
}: {
  eventId: string;
  rows: RosterRow[];
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Roster ({rows.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          Includes RSVP&apos;d, invited, and already-attended members.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">RSVP</th>
              <th className="px-3 py-2 font-medium">Waitlist #</th>
              <th className="px-3 py-2 font-medium">Attended</th>
              <th className="px-3 py-2 font-medium">Invited</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const name =
                `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
                r.user_id.slice(0, 8);
              const email = r.student_email ?? r.google_email ?? "—";
              return (
                <tr key={r.user_id}>
                  <td className="px-3 py-2">{name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {email}
                  </td>
                  <td className="px-3 py-2">
                    <RsvpBadge status={r.rsvp_status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.waitlist_position ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.attended ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Yes ·{" "}
                        {r.checked_in_at
                          ? new Date(r.checked_in_at).toLocaleTimeString()
                          : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.invited ? "Yes" : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.rsvp_status === "waitlisted" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            run(() =>
                              promoteWaitlistedMember(eventId, r.user_id)
                            )
                          }
                          disabled={pending}
                        >
                          Promote
                        </Button>
                      ) : null}
                      {!r.attended ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            run(() => adminCheckIn(eventId, r.user_id))
                          }
                          disabled={pending}
                        >
                          Check in
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            run(() =>
                              correctAttendance(
                                eventId,
                                r.user_id,
                                "remove"
                              )
                            )
                          }
                          disabled={pending}
                        >
                          Remove attendance
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No one on the roster yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RsvpBadge({
  status,
}: {
  status: RosterRow["rsvp_status"];
}) {
  if (!status) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const tone =
    status === "going"
      ? "bg-primary/10 text-primary"
      : status === "waitlisted"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : status === "declined"
          ? "bg-muted text-muted-foreground"
          : "bg-destructive/10 text-destructive";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  );
}
