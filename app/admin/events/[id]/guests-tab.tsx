"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Mail, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminCheckIn,
  adminCheckInByToken,
  correctAttendance,
  correctGuestAttendance,
  removeGuestRsvp,
  removeRsvp,
  inviteMemberByEmail,
  promoteWaitlistedMember,
  revokeInvite,
} from "@/lib/actions/events";

import { FoldSection } from "./_components/fold-section";
import {
  AttendeeTable,
  guestRowToAttendee,
  initialsAvatar,
  rosterRowToAttendee,
  type AttendeeRow,
} from "./_components/attendee-table";
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
      <AttendeesSection eventId={eventId} rows={rows} guestRsvps={guestRsvps} />
      <InviteSection eventId={eventId} event={event} invites={invites} />
    </div>
  );
}

// Roster (members) and Guest RSVPs used to be two separate sections with
// different columns; door staff and admins both just think in terms of one
// attendee list. Merged into AttendeeTable (shared with the /checkin
// surface), actions still dispatch per-kind since members and guests check
// in/remove through different server actions.
function AttendeesSection({
  eventId,
  rows,
  guestRsvps,
}: {
  eventId: string;
  rows: RosterRow[];
  guestRsvps: GuestRsvpRow[];
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

  const attendees: AttendeeRow[] = [
    ...rows.map(rosterRowToAttendee),
    ...guestRsvps.map(guestRowToAttendee),
  ];

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
        rows={attendees}
        renderActions={(a) =>
          a.kind === "member" ? (
            <RosterRowActions
              eventId={eventId}
              row={a.raw as RosterRow}
              pending={pending}
              run={run}
            />
          ) : (
            <GuestRowActions
              eventId={eventId}
              row={a.raw as GuestRsvpRow}
              pending={pending}
              run={run}
            />
          )
        }
      />
    </div>
  );
}

// Account-free guest RSVPs (2026-08-21 decision). Guests now carry their own
// checkin_token, so check-in runs through adminCheckInByToken — literally the
// same server action + RPC the QR scanner uses, since the door has one token
// space regardless of whether the ticket belongs to a member or a guest. No
// promote action yet: waitlist promotion is still member-only (promote_
// waitlisted_member takes a user_id).
function GuestRowActions({
  eventId,
  row,
  pending,
  run,
}: {
  eventId: string;
  row: GuestRsvpRow;
  pending: boolean;
  run: (
    fn: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>
  ) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Token is null unless the guest is 'going'; a waitlisted or
          cancelled guest has no ticket to redeem. */}
      {row.checkin_token && !row.checked_in_at ? (
        <Button
          type="button"
          size="sm"
          onClick={() =>
            run(() => adminCheckInByToken(row.checkin_token as string, eventId))
          }
          disabled={pending}
        >
          Check in
        </Button>
      ) : row.checked_in_at ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => run(() => correctGuestAttendance(eventId, row.id))}
          disabled={pending}
        >
          Remove attendance
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => {
          if (!window.confirm("Remove this RSVP? This can't be undone.")) return;
          run(() => removeGuestRsvp(eventId, row.id));
        }}
        disabled={pending}
      >
        Remove RSVP
      </Button>
    </div>
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

/** Shared between the AttendeeTable Actions column and the mobile card. */
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
