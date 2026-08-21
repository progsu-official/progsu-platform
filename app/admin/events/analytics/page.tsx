import Link from "next/link";
import { Mail } from "lucide-react";

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

// Windows are nested (30d ⊆ 90d ⊆ year), so on an instance with few seeded
// events the wider windows often carry identical totals to the narrower one
// — that's real, not a bug. Surfacing the relationship explicitly is what
// keeps three identical-looking cards from reading as a glitch.
function isSameTotals(a: WindowData, b: WindowData): boolean {
  return (
    (a.events_run ?? 0) === (b.events_run ?? 0) &&
    (a.total_going ?? 0) === (b.total_going ?? 0) &&
    (a.total_checkin ?? 0) === (b.total_checkin ?? 0)
  );
}

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {results.map(({ window, data, error }, i) => {
          const prev = i > 0 ? results[i - 1] : null;
          const sameAsPrevious =
            data && prev?.data && !prev.error && isSameTotals(data, prev.data)
              ? prev.window.label
              : null;
          return (
            <WindowCard
              key={window.days}
              label={window.label}
              primary={i === 0}
              data={data}
              error={error}
              sameAsPrevious={sameAsPrevious}
            />
          );
        })}
      </div>
    </div>
  );
}

function CardHeader({ label, primary }: { label: string; primary: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-foreground">{label}</h2>
      {primary ? (
        <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-primary">
          Current
        </span>
      ) : null}
    </div>
  );
}

function WindowCard({
  label,
  primary,
  data,
  error,
  sameAsPrevious,
}: {
  label: string;
  primary: boolean;
  data: WindowData | null;
  error: string | null;
  sameAsPrevious: string | null;
}) {
  if (error || !data) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <CardHeader label={label} primary={primary} />
        <p className="mt-2 text-sm text-destructive">
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
      <div className="rounded-2xl border border-dashed border-border/80 p-5">
        <CardHeader label={label} primary={primary} />
        <p className="mt-3 text-sm text-muted-foreground">
          No events ran in this window.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border bg-card p-5 " +
        (primary ? "border-primary/30" : "border-border/70")
      }
    >
      {primary ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
        />
      ) : null}

      <div className="relative">
        <CardHeader label={label} primary={primary} />
        {sameAsPrevious ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Same totals as {sameAsPrevious} — no events outside that window.
          </p>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Events run" value={String(eventsRun)} />
          <Stat label="Total going" value={String(totalGoing)} />
          <Stat label="Total check-ins" value={String(totalCheckin)} />
          <Stat
            label="Avg attendance"
            value={
              avgRate != null ? `${Math.round(Number(avgRate) * 100)}%` : "—"
            }
          />
          <Stat label="Members-wide" value={String(members)} />
          <Stat label="Private-invite" value={String(privateInvite)} />
        </dl>

        <EmailDeliveryLine entries={notifications} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </dd>
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
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;

  return (
    <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5">
      <Mail
        size={14}
        strokeWidth={1.75}
        aria-hidden
        className="mt-0.5 shrink-0 text-muted-foreground"
      />
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">
          No email activity in this window.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {pct(sent)}
          </span>{" "}
          sent ·{" "}
          <span className="tabular-nums">{pct(failed)}</span> failed ·{" "}
          <span className="tabular-nums">{pct(skipped)}</span> skipped
        </p>
      )}
    </div>
  );
}
