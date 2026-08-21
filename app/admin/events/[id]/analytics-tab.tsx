// Server component — renders the jsonb blob from admin_event_analytics_for
// as tiles + grouped rows. No client JS.

import {
  BellRing,
  CalendarCheck,
  Clock,
  QrCode,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { FoldSection } from "./_components/fold-section";

type AnalyticsData = {
  event?: {
    title?: string;
    capacity?: number | null;
    waitlist_enabled?: boolean;
    starts_at?: string;
    ends_at?: string;
    created_at?: string;
    published_at?: string | null;
    cancelled_at?: string | null;
    cancellation_reason?: string | null;
    reminder_sent_at?: string | null;
    archived_at?: string | null;
  };
  rsvp?: {
    going?: number;
    waitlisted?: number;
    declined?: number;
    cancelled?: number;
  };
  attendance?: {
    total?: number;
    self_code?: number;
    admin_click?: number;
    walk_ins?: number;
    no_shows?: number;
    promoted_from_waitlist?: number;
  };
  timing?: {
    first_rsvp_at?: string | null;
    first_checkin_at?: string | null;
  };
  notifications?: Record<string, number>;
};

export function AnalyticsTab({ data }: { data: Record<string, unknown> }) {
  const d = data as AnalyticsData;
  const rsvp = d.rsvp ?? {};
  const attendance = d.attendance ?? {};
  const timing = d.timing ?? {};
  const event = d.event ?? {};
  const notifications = d.notifications ?? {};

  const going = rsvp.going ?? 0;
  const capacity = event.capacity ?? null;
  const attended = attendance.total ?? 0;
  const attendanceRate =
    going > 0 ? Math.round((attended / going) * 100) : null;
  const eventEnded = event.ends_at
    ? new Date(event.ends_at).getTime() < Date.now()
    : false;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          icon={Users}
          label="Going"
          value={String(going)}
          hint={capacity != null ? `of ${capacity}` : null}
        />
        <StatTile
          icon={CalendarCheck}
          label="Attendance"
          value={
            attendanceRate != null
              ? `${attended} / ${going}`
              : `${attended}`
          }
          hint={
            !eventEnded
              ? "event ongoing"
              : attendanceRate != null
                ? `${attendanceRate}%`
                : null
          }
        />
        <StatTile
          icon={UserPlus}
          label="Walk-ins"
          value={String(attendance.walk_ins ?? 0)}
          hint="no prior RSVP"
        />
        <StatTile
          icon={UserX}
          label="No-shows"
          value={eventEnded ? String(attendance.no_shows ?? 0) : "—"}
          hint={eventEnded ? "going w/o check-in" : "after event ends"}
        />
        <StatTile
          icon={QrCode}
          label="Check-in method"
          value={`${attendance.self_code ?? 0} / ${attendance.admin_click ?? 0}`}
          hint="self / admin"
        />
        <StatTile
          icon={Clock}
          label="Waitlist"
          value={String(rsvp.waitlisted ?? 0)}
          hint={event.waitlist_enabled ? "enabled" : "disabled"}
        />
      </div>

      <FoldSection
        summary={
          <h3 className="text-sm font-semibold text-foreground">
            RSVP breakdown
          </h3>
        }
      >
        <div className="divide-y divide-border/60">
          <Row label="Going" value={rsvp.going ?? 0} />
          <Row label="Waitlisted" value={rsvp.waitlisted ?? 0} />
          <Row label="Declined" value={rsvp.declined ?? 0} />
          <Row label="Cancelled" value={rsvp.cancelled ?? 0} />
          <Row
            label="Promoted from waitlist"
            value={attendance.promoted_from_waitlist ?? 0}
            muted
          />
          <Row label="Walk-ins" value={attendance.walk_ins ?? 0} muted />
        </div>
      </FoldSection>

      <FoldSection
        summary={
          <h3 className="text-sm font-semibold text-foreground">Timing</h3>
        }
      >
        <div className="divide-y divide-border/60">
          <TimeRow label="Created" at={event.created_at} />
          <TimeRow label="Published" at={event.published_at ?? null} />
          <TimeRow label="First RSVP" at={timing.first_rsvp_at ?? null} />
          <TimeRow label="First check-in" at={timing.first_checkin_at ?? null} />
          <TimeRow label="Event start" at={event.starts_at} />
          <TimeRow label="Event end" at={event.ends_at} />
          <TimeRow
            label="Reminder sent"
            at={event.reminder_sent_at ?? null}
            icon={BellRing}
          />
          {event.cancelled_at ? (
            <>
              <TimeRow label="Cancelled" at={event.cancelled_at} />
              {event.cancellation_reason ? (
                <div className="flex items-center gap-3 py-3">
                  <p className="w-40 shrink-0 text-sm text-muted-foreground">
                    Reason
                  </p>
                  <p className="text-sm text-foreground">
                    {event.cancellation_reason}
                  </p>
                </div>
              ) : null}
              {event.starts_at ? (
                <div className="flex items-center gap-3 py-3">
                  <p className="w-40 shrink-0 text-sm text-muted-foreground">
                    Cancellation lead time
                  </p>
                  <p className="text-sm text-foreground">
                    {formatLead(event.cancelled_at, event.starts_at)}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
          <TimeRow label="Archived" at={event.archived_at ?? null} />
        </div>
      </FoldSection>

      <FoldSection
        summary={
          <h3 className="text-sm font-semibold text-foreground">
            Notifications
          </h3>
        }
      >
        <NotificationsMatrix entries={notifications} />
      </FoldSection>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon size={13} strokeWidth={1.75} aria-hidden />
        {label}
      </div>
      <p className="mt-2 text-xl font-bold tracking-tight tabular-nums text-foreground sm:text-2xl">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <p
        className={
          "text-sm " + (muted ? "text-muted-foreground" : "text-foreground")
        }
      >
        {label}
      </p>
      <p className="text-sm tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function TimeRow({
  label,
  at,
  icon: Icon,
}: {
  label: string;
  at: string | null | undefined;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <p className="flex w-40 shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
        {Icon ? <Icon size={13} strokeWidth={1.75} aria-hidden /> : null}
        {label}
      </p>
      <p className="text-sm text-foreground">
        {at ? new Date(at).toLocaleString() : "—"}
      </p>
    </div>
  );
}

function NotificationsMatrix({
  entries,
}: {
  entries: Record<string, number>;
}) {
  const kinds = ["confirmation", "reminder", "cancellation"];
  const statuses = ["pending", "in_flight", "sent", "failed", "skipped"];

  if (Object.keys(entries).length === 0) {
    return <p className="text-sm text-muted-foreground">No jobs yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border/70">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left">Kind</th>
            {statuses.map((s) => (
              <th key={s} className="px-4 py-3 text-right capitalize">
                {s.replace("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {kinds.map((k) => (
            <tr key={k}>
              <td className="px-4 py-3 font-medium capitalize text-foreground">
                {k}
              </td>
              {statuses.map((s) => {
                const n = entries[`${k}:${s}`] ?? 0;
                return (
                  <td
                    key={s}
                    className={
                      "px-4 py-3 text-right tabular-nums " +
                      (n === 0 ? "text-muted-foreground" : "text-foreground")
                    }
                  >
                    {n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatLead(cancelledAt: string, startsAt: string): string {
  const diffMs = new Date(startsAt).getTime() - new Date(cancelledAt).getTime();
  const past = diffMs < 0;
  const hours = Math.abs(diffMs) / (1000 * 60 * 60);
  if (hours < 24) {
    const h = Math.round(hours);
    return past ? `${h}h after start` : `${h}h in advance`;
  }
  const days = Math.floor(hours / 24);
  const remHours = Math.round(hours % 24);
  const label = `${days}d ${remHours}h`;
  return past ? `${label} after start` : `${label} in advance`;
}
