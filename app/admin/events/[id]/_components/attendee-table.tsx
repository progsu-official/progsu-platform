"use client";

import { Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FoldSection } from "./fold-section";
import type { GuestRsvpRow, RosterRow } from "../types";

// One row shape for the door: a member RSVP and a guest RSVP used to render
// as two separate sections (Roster, Guest RSVPs) with different columns.
// Staff and admins both just want "who's coming, who's checked in" — kind
// is kept only to route per-row actions back to the right server action.
export type AttendeeRow = {
  id: string;
  kind: "member" | "guest";
  name: string;
  email: string | null;
  status: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
  // Absent for the admin Attendees tab (its actions read straight from raw
  // below). Set for the door-staff /checkin surface's guest rows so its
  // manual "Check in" button can redeem it via staffCheckInByToken, same
  // token the QR scan already resolves — see staffEventAttendees.
  checkinToken?: string | null;
  // Absent for the door-staff /checkin surface, which has no admin session
  // to act with — its rows are search/display-only (see staffEventAttendees).
  raw?: RosterRow | GuestRsvpRow;
};

export function rosterRowToAttendee(r: RosterRow): AttendeeRow {
  const name =
    `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
    (r.user_id ?? r.legacy_member_id ?? "").slice(0, 8);
  return {
    id: r.user_id ?? r.legacy_member_id ?? name,
    kind: "member",
    name,
    email: r.student_email ?? r.google_email ?? r.legacy_email ?? null,
    status: r.rsvp_status,
    checkedIn: r.attended,
    checkedInAt: r.checked_in_at,
    raw: r,
  };
}

export function guestRowToAttendee(r: GuestRsvpRow): AttendeeRow {
  return {
    id: r.id,
    kind: "guest",
    name: r.name,
    email: r.email,
    status: r.status,
    checkedIn: !!r.checked_in_at,
    checkedInAt: r.checked_in_at,
    raw: r,
  };
}

export function initialsAvatar(label: string) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold uppercase text-primary"
    >
      {label.charAt(0) || "?"}
    </span>
  );
}

export function RsvpBadge({ status }: { status: string | null }) {
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

type StatusFilter = "all" | "in" | "out" | "guest";

// Shared by the admin Attendees tab (full actions) and the door-staff
// /checkin surface (read-only, renderActions omitted) — one search/filter/
// table implementation instead of two.
export function AttendeeTable({
  rows,
  renderActions,
}: {
  rows: AttendeeRow[];
  renderActions?: (row: AttendeeRow) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === "in") return r.checkedIn;
        if (filter === "out") return !r.checkedIn;
        if (filter === "guest") return r.kind === "guest";
        return true;
      })
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, query, filter]);

  const checkedInCount = rows.filter((r) => r.checkedIn).length;
  const colSpan = renderActions ? 4 : 3;

  return (
    <FoldSection
      summary={
        <div className="flex items-center gap-2">
          <Users
            size={18}
            strokeWidth={1.75}
            className="text-muted-foreground"
            aria-hidden
          />
          <h2 className="text-base font-semibold text-foreground">
            Attendees ({rows.length})
          </h2>
        </div>
      }
    >
      <p className="text-xs text-muted-foreground">
        {checkedInCount} of {rows.length} checked in. Members and guest
        RSVPs together.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            size={15}
            strokeWidth={1.75}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className="rounded-xl pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "in", "out", "guest"] as const).map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "All"
                : f === "in"
                  ? "Checked in"
                  : f === "out"
                    ? "Not checked in"
                    : "Guests"}
            </Button>
          ))}
        </div>
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border/70 sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Checked in</th>
              {renderActions ? (
                <th className="px-4 py-3 font-semibold">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filtered.map((r) => (
              <tr
                key={`${r.kind}-${r.id}`}
                className="transition-colors hover:bg-muted/20"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {initialsAvatar(r.name)}
                    <div className="min-w-0">
                      <p className="truncate text-[15px] text-foreground">
                        {r.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.email ?? "—"}
                        {r.kind === "guest" ? " · guest" : ""}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <RsvpBadge status={r.status} />
                </td>
                <td className="px-4 py-3 text-xs">
                  {r.checkedIn ? (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Yes
                      {r.checkedInAt
                        ? ` · ${new Date(r.checkedInAt).toLocaleTimeString()}`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {renderActions ? (
                  <td className="px-4 py-3">{renderActions(r)}</td>
                ) : null}
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  No matches.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border/60 rounded-xl border border-border/70 sm:hidden">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No matches.
          </p>
        ) : (
          filtered.map((r) => (
            <div key={`${r.kind}-${r.id}`} className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {initialsAvatar(r.name)}
                  <div className="min-w-0">
                    <p className="truncate text-[15px] text-foreground">
                      {r.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.email ?? "—"}
                      {r.kind === "guest" ? " · guest" : ""}
                    </p>
                  </div>
                </div>
                <RsvpBadge status={r.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                Checked in:{" "}
                {r.checkedIn ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Yes
                    {r.checkedInAt
                      ? ` · ${new Date(r.checkedInAt).toLocaleTimeString()}`
                      : ""}
                  </span>
                ) : (
                  "—"
                )}
              </p>
              {renderActions ? renderActions(r) : null}
            </div>
          ))
        )}
      </div>
    </FoldSection>
  );
}
