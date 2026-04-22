import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

// Cross-event analytics rollup. Admin layout has already gated on is_admin,
// so we don't re-check here. User-context client is required: the RPC is
// SECURITY DEFINER + volatile and checks auth.uid() for admin + writes an
// audit row — service-role has no auth.uid() and PostgREST-GET-on-stable
// would fail the INSERT. See roadmap/03 §3.1.

export const dynamic = "force-dynamic";

const WINDOWS: Array<{ days: number; label: string }> = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last year" },
];

type WindowData = {
  window_days?: number;
  events_run?: number;
  total_going?: number;
  total_checkin?: number;
  avg_attendance_rate?: number | null;
  visibility?: { members?: number; private_invite?: number };
  notifications?: Record<string, number>;
};

export default async function AdminEventsAnalyticsPage() {
  const supabase = await createClient();
  const results = await Promise.all(
    WINDOWS.map(async (w) => {
      const { data, error } = await supabase.rpc(
        "admin_cross_event_analytics",
        { p_window_days: w.days }
      );
      return {
        window: w,
        data: (data as WindowData) ?? null,
        error: error?.message ?? null,
      };
    })
  );

  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted-foreground">
        <Link href="/admin/events" className="hover:underline">
          ← All events
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Events analytics</h1>
        <p className="text-sm text-muted-foreground">
          Aggregate operational numbers across three time windows. Numbers
          update on each page load.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {results.map(({ window, data, error }) => (
          <WindowCard
            key={window.days}
            label={window.label}
            data={data}
            error={error}
          />
        ))}
      </div>
    </div>
  );
}

function WindowCard({
  label,
  data,
  error,
}: {
  label: string;
  data: WindowData | null;
  error: string | null;
}) {
  if (error || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <h2 className="text-sm font-semibold">{label}</h2>
        <p className="mt-2 text-xs text-destructive">
          {error ?? "No data returned."}
        </p>
      </div>
    );
  }

  const eventsRun = data.events_run ?? 0;
  const totalGoing = data.total_going ?? 0;
  const totalCheckin = data.total_checkin ?? 0;
  const avgRate = data.avg_attendance_rate;
  const members = data.visibility?.members ?? 0;
  const privateInvite = data.visibility?.private_invite ?? 0;
  const notifications = data.notifications ?? {};

  if (eventsRun === 0) {
    return (
      <div className="rounded-md border p-4">
        <h2 className="text-sm font-semibold">{label}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No events ran in this window.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-4">
      <h2 className="text-sm font-semibold">{label}</h2>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Stat label="Events run" value={String(eventsRun)} />
        <Stat label="Total going" value={String(totalGoing)} />
        <Stat label="Total check-ins" value={String(totalCheckin)} />
        <Stat
          label="Avg attendance"
          value={
            avgRate != null
              ? `${Math.round(Number(avgRate) * 100)}%`
              : "—"
          }
        />
        <Stat label="Members-wide" value={String(members)} />
        <Stat label="Private-invite" value={String(privateInvite)} />
      </dl>

      <EmailDeliveryLine entries={notifications} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function EmailDeliveryLine({ entries }: { entries: Record<string, number> }) {
  const sent = Object.entries(entries)
    .filter(([k]) => k.endsWith(":sent"))
    .reduce((a, [, v]) => a + v, 0);
  const failed = Object.entries(entries)
    .filter(([k]) => k.endsWith(":failed"))
    .reduce((a, [, v]) => a + v, 0);
  const skipped = Object.entries(entries)
    .filter(([k]) => k.endsWith(":skipped"))
    .reduce((a, [, v]) => a + v, 0);
  const total = sent + failed + skipped;
  if (total === 0) {
    return (
      <p className="mt-4 text-[11px] text-muted-foreground">
        No email activity.
      </p>
    );
  }
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <p className="mt-4 text-[11px] text-muted-foreground">
      Email: {pct(sent)} sent · {pct(failed)} failed · {pct(skipped)} skipped
    </p>
  );
}
