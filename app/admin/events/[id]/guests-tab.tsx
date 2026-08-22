"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Mail, UserPlus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminCheckIn,
  adminCheckInByToken,
  correctAttendance,
  removeRsvp,
  inviteMemberByEmail,
  promoteWaitlistedMember,
  revokeInvite,
} from "@/lib/actions/events";

import { FoldSection } from "./_components/fold-section";
import type { EventRecord, GuestRsvpRow, RosterRow } from "./types";

type InviteRow = {
  user_id: string;
  invited_by: string | null;
  invited_at: string;
  revoked_at: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

function initialsAvatar(label: string) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold uppercase text-primary"
    >
      {label.charAt(0) || "?"}
    </span>
  );
}

export function GuestsTab({
  eventId,
  event,
  rows,
  invites,
  guestRsvps,
}: {
  eventId: string;
  event: EventRecord;
  rows: RosterRow[];
  invites: InviteRow[];
  guestRsvps: GuestRsvpRow[];
}) {
  return (
    <div className="space-y-6">
      <RosterSection eventId={eventId} rows={rows} />
      <GuestRsvpSection rows={guestRsvps} />
      <InviteSection eventId={eventId} event={event} invites={invites} />
    </div>
  );
}

// Account-free guest RSVPs (2026-08-21 decision). Guests now carry their own
// checkin_token, so check-in runs through adminCheckInByToken — literally the
// same server action + RPC the QR scanner uses, since the door has one token
// space regardless of whether the ticket belongs to a member or a guest. No
// promote action yet: waitlist promotion is still member-only (promote_
// waitlisted_member takes a user_id).
function GuestRsvpSection({ rows }: { rows: GuestRsvpRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCheckIn(token: string) {
    setError(null);
    startTransition(async () => {
      const r = await adminCheckInByToken(token);
      if (!r.ok) setError(r.error.message);
      else router.refresh();
    });
  }

  return (
    <FoldSection
      summary={
        <h2 className="text-base font-semibold text-foreground">
          Guest RSVPs ({rows.length})
        </h2>
      }
    >
      <p className="text-xs text-muted-foreground">
        Signed-out visitors who registered without a member account.
      </p>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No guest RSVPs yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3 last:border-b-0"
            >
              {initialsAvatar(r.name)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-foreground">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.email} · {r.phone}
                </p>
              </div>
              <p className="text-xs">
                {r.checked_in_at ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Yes ·{" "}
                    {new Date(r.checked_in_at).toLocaleTimeString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
              <RsvpBadge status={r.status} />
              {/* Token is null unless the guest is 'going'; a waitlisted or
                  cancelled guest has no ticket to redeem. */}
              {r.checkin_token && !r.checked_in_at ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onCheckIn(r.checkin_token as string)}
                  disabled={pending}
                >
                  Check in
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </FoldSection>
  );
}

// Folded in from the removed Access tab — invite-by-email only gates
// anything for private_invite events; for members-visibility events this
// just pre-lists people, same non-restrictive behavior the old tab had.
function InviteSection({
  eventId,
  event,
  invites,
}: {
  eventId: string;
  event: EventRecord;
  invites: InviteRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const addr = email.trim();
    if (!addr) {
      setError("Enter an email address.");
      return;
    }
    startTransition(async () => {
      const r = await inviteMemberByEmail(eventId, addr);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setEmail("");
      setNotice(`Invited ${r.data.email}.`);
      router.refresh();
    });
  }

  function onRevoke(targetUserId: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await revokeInvite(eventId, targetUserId);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  const active = invites.filter((i) => !i.revoked_at);
  const revoked = invites.filter((i) => i.revoked_at);

  return (
    <FoldSection
      summary={
        <h2 className="text-base font-semibold text-foreground">
          Invites ({active.length})
        </h2>
      }
    >
      <p className="text-sm text-muted-foreground">
        {event.visibility === "members"
          ? "Any fully-onboarded member can already see and RSVP — invites below just pre-list members."
          : "Only invited members can view or RSVP. Revoke to remove access immediately."}
      </p>

      <form
        onSubmit={onInvite}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-muted/20 p-4"
      >
        <div className="min-w-64 flex-1 space-y-1.5">
          <label
            htmlFor="invite-email"
            className="text-xs font-medium text-muted-foreground"
          >
            Invite by email
          </label>
          <div className="relative">
            <Mail
              size={15}
              strokeWidth={1.75}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@gsu.edu"
              disabled={pending}
              className="rounded-xl pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Matches the member&apos;s Google or student email. They must have
            signed in at least once to appear.
          </p>
        </div>
        <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
          <UserPlus size={14} strokeWidth={1.75} aria-hidden />
          {pending ? "Inviting…" : "Invite"}
        </Button>
      </form>

      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground"
        >
          {notice}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Active invites ({active.length})
        </h3>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active invites.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70">
            {active.map((i) => {
              const name =
                `${i.first_name ?? ""} ${i.last_name ?? ""}`.trim() ||
                i.user_id.slice(0, 8);
              return (
                <div
                  key={i.user_id}
                  className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                >
                  {initialsAvatar(name)}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] text-foreground">
                      {name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {i.email ?? "—"} · invited{" "}
                      {new Date(i.invited_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRevoke(i.user_id)}
                    disabled={pending}
                  >
                    Revoke
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {revoked.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Revoked ({revoked.length})
          </h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {revoked.map((i) => (
              <li key={`rev-${i.user_id}`}>
                {i.first_name ?? i.user_id.slice(0, 8)} — revoked{" "}
                {i.revoked_at
                  ? new Date(i.revoked_at).toLocaleDateString()
                  : "—"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </FoldSection>
  );
}

function RosterSection({
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
    <FoldSection
      summary={
        <div className="flex items-center gap-2">
          <Users size={18} strokeWidth={1.75} className="text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">
            Roster ({rows.length})
          </h2>
        </div>
      }
    >
      <p className="text-xs text-muted-foreground">
        RSVP&apos;d, invited, and already-attended members.
      </p>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {/* Full table is unreadable below sm (7 columns don't fit without
          horizontal scroll) — a compact stacked card carries the same data
          on phones instead of forcing a scroll to see it. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border/70 sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">RSVP</th>
              <th className="px-4 py-3 font-semibold">Waitlist #</th>
              <th className="px-4 py-3 font-semibold">Attended</th>
              <th className="px-4 py-3 font-semibold">Check-in</th>
              <th className="px-4 py-3 font-semibold">Invited</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => {
              const name =
                `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
                (r.user_id ?? r.legacy_member_id ?? "").slice(0, 8);
              const email = r.student_email ?? r.google_email ?? r.legacy_email ?? "—";
              return (
                <tr
                  key={r.user_id ?? r.legacy_member_id}
                  className="transition-colors hover:bg-muted/20"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {initialsAvatar(name)}
                      <div className="min-w-0">
                        <p className="truncate text-[15px] text-foreground">
                          {name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RsvpBadge status={r.rsvp_status} />
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                    {r.waitlist_position ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.attended ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Yes ·{" "}
                        {r.checked_in_at
                          ? new Date(r.checked_in_at).toLocaleTimeString()
                          : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.attendance_method === "qr_token"
                      ? "QR scan"
                      : r.attendance_method === "admin_click"
                        ? "Manual"
                        : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.invited ? "Yes" : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <RosterRowActions
                      eventId={eventId}
                      row={r}
                      pending={pending}
                      run={run}
                    />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No one on the roster yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border/60 rounded-xl border border-border/70 sm:hidden">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No one on the roster yet.
          </p>
        ) : (
          rows.map((r) => {
            const name =
              `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
              (r.user_id ?? r.legacy_member_id ?? "").slice(0, 8);
            const email = r.student_email ?? r.google_email ?? r.legacy_email ?? "—";
            return (
              <div key={r.user_id ?? r.legacy_member_id} className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {initialsAvatar(name)}
                    <div className="min-w-0">
                      <p className="truncate text-[15px] text-foreground">
                        {name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {email}
                      </p>
                    </div>
                  </div>
                  <RsvpBadge status={r.rsvp_status} />
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <p>Waitlist #{r.waitlist_position ?? "—"}</p>
                  <p>
                    Attended:{" "}
                    {r.attended ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Yes
                        {r.checked_in_at
                          ? ` · ${new Date(r.checked_in_at).toLocaleTimeString()}`
                          : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </p>
                  <p>
                    Check-in:{" "}
                    {r.attendance_method === "qr_token"
                      ? "QR scan"
                      : r.attendance_method === "admin_click"
                        ? "Manual"
                        : "—"}
                  </p>
                  <p>Invited: {r.invited ? "Yes" : "—"}</p>
                </div>
                <RosterRowActions
                  eventId={eventId}
                  row={r}
                  pending={pending}
                  run={run}
                />
              </div>
            );
          })
        )}
      </div>
    </FoldSection>
  );
}

export function RsvpBadge({
  status,
}: {
  status: RosterRow["rsvp_status"] | GuestRsvpRow["status"];
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  );
}

/** Shared between the desktop table's Actions column and the mobile card. */
function RosterRowActions({
  eventId,
  row,
  pending,
  run,
}: {
  eventId: string;
  row: RosterRow;
  pending: boolean;
  run: (
    fn: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>
  ) => void;
}) {
  const userId = row.user_id;
  if (row.is_historical || !userId) {
    return (
      <span className="text-xs text-muted-foreground" title="Imported from a pre-platform source; no live account to act on.">
        Imported
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {row.rsvp_status === "waitlisted" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => run(() => promoteWaitlistedMember(eventId, userId))}
          disabled={pending}
        >
          Promote
        </Button>
      ) : null}
      {!row.attended ? (
        <Button
          type="button"
          size="sm"
          onClick={() => run(() => adminCheckIn(eventId, userId))}
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
            run(() => correctAttendance(eventId, userId, "remove"))
          }
          disabled={pending}
        >
          Remove attendance
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => {
          if (!window.confirm("Remove this RSVP? This can't be undone."))
            return;
          run(() => removeRsvp(eventId, userId));
        }}
        disabled={pending}
      >
        Remove RSVP
      </Button>
    </div>
  );
}
