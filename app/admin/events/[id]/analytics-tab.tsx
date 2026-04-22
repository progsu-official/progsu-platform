// Server component — renders the jsonb blob from admin_event_analytics_for
// as tiles + small tables. No client JS.

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
          label="Going"
          value={String(going)}
          hint={capacity != null ? `of ${capacity}` : null}
        />
        <StatTile
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
          label="Walk-ins"
          value={String(attendance.walk_ins ?? 0)}
          hint="no prior RSVP"
        />
        <StatTile
          label="No-shows"
          value={eventEnded ? String(attendance.no_shows ?? 0) : "—"}
          hint={eventEnded ? "going w/o check-in" : "after event ends"}
        />
        <StatTile
          label="Check-in method"
          value={`${attendance.self_code ?? 0} / ${attendance.admin_click ?? 0}`}
          hint="self / admin"
        />
        <StatTile
          label="Waitlist"
          value={String(rsvp.waitlisted ?? 0)}
          hint={event.waitlist_enabled ? "enabled" : "disabled"}
        />
      </div>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
          RSVP breakdown
        </h3>
        <table className="w-full overflow-hidden rounded-md border text-sm">
          <tbody className="divide-y">
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
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
          Timing
        </h3>
        <table className="w-full overflow-hidden rounded-md border text-sm">
          <tbody className="divide-y">
            <TimeRow label="Created" at={event.created_at} />
            <TimeRow label="Published" at={event.published_at ?? null} />
            <TimeRow label="First RSVP" at={timing.first_rsvp_at ?? null} />
            <TimeRow label="First check-in" at={timing.first_checkin_at ?? null} />
            <TimeRow label="Event start" at={event.starts_at} />
            <TimeRow label="Event end" at={event.ends_at} />
            <TimeRow label="Reminder sent" at={event.reminder_sent_at ?? null} />
            {event.cancelled_at ? (
              <>
                <TimeRow label="Cancelled" at={event.cancelled_at} />
                {event.cancellation_reason ? (
                  <tr>
                    <td className="px-3 py-2 font-medium text-muted-foreground">
                      Reason
                    </td>
                    <td className="px-3 py-2">{event.cancellation_reason}</td>
                  </tr>
                ) : null}
                {event.starts_at ? (
                  <tr>
                    <td className="px-3 py-2 font-medium text-muted-foreground">
                      Cancellation lead time
                    </td>
                    <td className="px-3 py-2">
                      {formatLead(event.cancelled_at, event.starts_at)}
                    </td>
                  </tr>
                ) : null}
              </>
            ) : null}
            <TimeRow label="Archived" at={event.archived_at ?? null} />
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
          Notifications
        </h3>
        <NotificationsMatrix entries={notifications} />
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint ? (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
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
    <tr>
      <td
        className={
          "px-3 py-2 font-medium " +
          (muted ? "text-muted-foreground" : "text-foreground")
        }
      >
        {label}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{value}</td>
    </tr>
  );
}

function TimeRow({ label, at }: { label: string; at: string | null | undefined }) {
  return (
    <tr>
      <td className="px-3 py-2 font-medium text-muted-foreground">{label}</td>
      <td className="px-3 py-2 text-xs">
        {at ? new Date(at).toLocaleString() : "—"}
      </td>
    </tr>
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
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Kind</th>
            {statuses.map((s) => (
              <th key={s} className="px-3 py-2 text-right font-medium capitalize">
                {s.replace("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {kinds.map((k) => (
            <tr key={k}>
              <td className="px-3 py-2 font-medium capitalize">{k}</td>
              {statuses.map((s) => {
                const n = entries[`${k}:${s}`] ?? 0;
                return (
                  <td
                    key={s}
                    className={
                      "px-3 py-2 text-right tabular-nums " +
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
