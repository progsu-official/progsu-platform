"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminCheckIn, correctAttendance } from "@/lib/actions/events";

type Row = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  student_email: string | null;
  google_email: string | null;
  rsvp_status: string | null;
  attended: boolean;
  checked_in_at: string | null;
  fully_onboarded: boolean;
};

export function DayOfRoster({
  eventId,
  rows,
}: {
  eventId: string;
  rows: Row[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name =
        `${r.first_name ?? ""} ${r.last_name ?? ""} ${r.preferred_name ?? ""}`.toLowerCase();
      const email = `${r.student_email ?? ""} ${r.google_email ?? ""}`.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [rows, filter]);

  function run(
    targetId: string,
    fn: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>
  ) {
    setError(null);
    setBusyId(targetId);
    startTransition(async () => {
      const r = await fn();
      setBusyId(null);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by name or email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-base">
          <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">RSVP</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((r) => {
              const name =
                `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
                r.user_id.slice(0, 8);
              const email = r.student_email ?? r.google_email ?? "—";
              const rowBusy = busyId === r.user_id;
              const onboardingLabel = r.fully_onboarded
                ? "Profile onboarding complete"
                : "Profile onboarding incomplete — nudge to finish for recruiter visibility";
              return (
                <tr key={r.user_id} className="hover:bg-muted/10">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      {name}
                      <span
                        title={onboardingLabel}
                        className={
                          "inline-block size-1.5 shrink-0 rounded-full " +
                          (r.fully_onboarded
                            ? "bg-emerald-500"
                            : "bg-amber-500")
                        }
                      >
                        <span className="sr-only">{onboardingLabel}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {email}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.rsvp_status ?? "walk-in"}
                  </td>
                  <td className="px-3 py-2">
                    {r.attended ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <span aria-hidden>&#10003;</span>
                        {r.checked_in_at
                          ? new Date(r.checked_in_at).toLocaleTimeString()
                          : "Checked in"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Waiting
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.attended ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          run(r.user_id, () =>
                            correctAttendance(eventId, r.user_id, "remove")
                          )
                        }
                        disabled={pending && rowBusy}
                      >
                        Undo
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          run(r.user_id, () => adminCheckIn(eventId, r.user_id))
                        }
                        disabled={pending && rowBusy}
                      >
                        {pending && rowBusy ? "…" : "Check in"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No RSVPs yet."
                    : "No matches for that filter."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
