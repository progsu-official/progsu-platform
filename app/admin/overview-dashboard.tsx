import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Download,
  ScrollText,
  Settings,
  ShieldAlert,
  TriangleAlert,
  UserRoundCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  CLASS_STANDING_LABELS,
  INTERESTED_ROLE_LABELS,
  type ClassStanding,
  type InterestedRole,
} from "@/lib/enums/roles";

import {
  BarList,
  Funnel,
  Panel,
  type BarDatum,
} from "./_components/charts";
import {
  TimeSeriesChart,
  type ColumnDatum,
} from "./_components/time-series-chart";

// Shape of admin_platform_analytics() (migrations 20260824110000 +
// 20260824120000). One RPC, all aggregate, admin-gated inside the function.
export type Analytics = {
  members: {
    total: number;
    verified: number;
    unverified: number;
    admins: number;
    open_to_recruiters: number;
    with_avatar: number;
    with_links: number;
    with_resume: number;
    discoverable: number;
    archived: number;
    consents_current: number;
    onboarded: number;
    new_7d: number;
    new_30d: number;
    new_90d: number;
  };
  signups_weekly: Array<{ week: string; n: number }>;
  events: {
    total: number;
    upcoming: number;
    past: number;
    past_year: number;
    attendance: number;
    avg_head: number;
  };
  events_monthly: Array<{ month: string; events: number; attendance: number }>;
  top_events: Array<{ title: string; starts_at: string; head: number }>;
  class_standing: Array<{ key: string; n: number }>;
  roles: Array<{ key: string; n: number }>;
  schools: Array<{ key: string; n: number }>;
  legacy: { total: number; claimed: number };
  domain_requests: number;
  privacy_version: string | null;
  generated_at: string;
};

export function OverviewDashboard({ data }: { data: Analytics }) {
  const a = data;
  const m = a.members;
  const pctOf = (n: number) =>
    m.total === 0 ? 0 : Math.round((n / m.total) * 100);
  const consentsPending = Math.max(0, m.total - m.consents_current);

  return (
    <div className="space-y-6">
      {/* The one moment on this screen: the headline number and the shape of
          how it got there, in the same frame. Everything below is support. */}
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-28 h-72 w-[26rem] rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Members
              </p>
              <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums text-foreground">
                {m.total.toLocaleString()}
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {m.new_30d > 0 ? (
                  <>
                    <span className="font-medium tabular-nums text-primary">
                      +{m.new_30d.toLocaleString()}
                    </span>{" "}
                    in the last 30 days
                  </>
                ) : (
                  "No new signups in the last 30 days"
                )}
                {m.new_7d > 0 ? (
                  <>
                    {" · "}
                    <span className="tabular-nums">{m.new_7d}</span> this week
                  </>
                ) : null}
              </p>
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <MiniStat label="Verified students" value={m.verified} hint={`${pctOf(m.verified)}%`} />
              <MiniStat label="In the directory" value={m.discoverable} hint={`${pctOf(m.discoverable)}%`} />
              <MiniStat label="Admins" value={m.admins} />
            </dl>
          </div>

          <div>
            <TimeSeriesChart
              label="Signups per week"
              hint="Last 26 weeks"
              unit="signups"
              data={weeklyColumns(a.signups_weekly)}
              ariaLabel={weeklySummary(a.signups_weekly)}
              height="h-32"
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={CalendarDays}
          label="Events run"
          value={a.events.past.toLocaleString()}
          hint={
            a.events.upcoming > 0
              ? `${a.events.upcoming} upcoming`
              : "none scheduled"
          }
        />
        <StatTile
          icon={Users}
          label="Total attendance"
          value={a.events.attendance.toLocaleString()}
          hint={`${a.events.avg_head} avg per event`}
        />
        <StatTile
          icon={UserRoundCheck}
          label="Resumes on file"
          value={m.with_resume.toLocaleString()}
          hint={`${pctOf(m.with_resume)}% of members`}
        />
        <StatTile
          icon={ShieldAlert}
          label="Open to recruiters"
          value={m.open_to_recruiters.toLocaleString()}
          hint={`${pctOf(m.open_to_recruiters)}% opted in`}
        />
      </div>

      {/* Only rendered when there is something to do. An always-present
          "0 issues" band trains people to stop reading the band. */}
      {m.unverified > 0 || a.domain_requests > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {m.unverified > 0 ? (
            <ActionTile
              label="Unverified students"
              value={m.unverified}
              body="No confirmed .edu address yet — excluded from recruiter exports."
              href="/admin/members?verified=no"
            />
          ) : null}
          {a.domain_requests > 0 ? (
            <ActionTile
              label="Domain requests"
              value={a.domain_requests}
              body="Members asking for a school domain we don't recognise yet."
              href="/admin/domain-requests"
            />
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Onboarding"
          hint="Where people stop between signing up and being fully set up"
        >
          <Funnel
            ariaLabel={`Onboarding funnel: ${m.total} accounts, ${m.verified} verified, ${m.consents_current} with current consents, ${m.onboarded} fully onboarded`}
            steps={[
              { key: "accounts", label: "Accounts created", value: m.total },
              {
                key: "verified",
                label: "Student email verified",
                value: m.verified,
              },
              {
                key: "consents",
                label: "Consents up to date",
                value: m.consents_current,
              },
              {
                key: "onboarded",
                label: "Fully onboarded",
                value: m.onboarded,
                note: "Profile details complete and all three required consents current.",
              },
            ]}
          />
          {consentsPending > 0 ? (
            // Without this the funnel's last two steps look like a
            // catastrophe rather than the expected effect of a policy bump.
            <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-xs leading-relaxed text-amber-200">
              <span className="font-semibold tabular-nums">
                {consentsPending.toLocaleString()}
              </span>{" "}
              members haven&apos;t accepted privacy policy{" "}
              {a.privacy_version ?? "the current version"} yet. A version bump
              re-opens the consent step for everyone; they&apos;re routed
              through it automatically on their next visit, so this number
              falls on its own.
            </p>
          ) : null}
        </Panel>

        <Panel
          title="Profile depth"
          hint="How much of a profile members actually fill in"
        >
          <BarList
            max={m.total}
            ariaLabel={`Profile coverage out of ${m.total} members`}
            data={[
              { key: "avatar", label: "Photo", value: m.with_avatar, hint: `${pctOf(m.with_avatar)}%` },
              { key: "directory", label: "Listed in the directory", value: m.discoverable, hint: `${pctOf(m.discoverable)}%` },
              { key: "resume", label: "Current resume", value: m.with_resume, hint: `${pctOf(m.with_resume)}%` },
              { key: "links", label: "LinkedIn or GitHub", value: m.with_links, hint: `${pctOf(m.with_links)}%` },
              { key: "recruiters", label: "Open to recruiters", value: m.open_to_recruiters, hint: `${pctOf(m.open_to_recruiters)}%` },
            ]}
          />
        </Panel>
      </div>

      <Panel
        title="Attendance by month"
        hint={`${a.events.attendance.toLocaleString()} people across ${a.events.past.toLocaleString()} events`}
      >
        <TimeSeriesChart
          unit="attendees"
          data={monthlyColumns(a.events_monthly)}
          ariaLabel={monthlySummary(a.events_monthly)}
          height="h-32"
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Biggest turnouts" hint="Across every event on record">
          {a.top_events.length > 0 ? (
            <BarList
              tone="stepped"
              ariaLabel="Best attended events"
              data={a.top_events.map((e, i) => ({
                key: `${e.title}-${i}`,
                label: e.title,
                value: e.head,
                hint: monthYear(e.starts_at),
              }))}
            />
          ) : (
            <EmptyLine>No events with recorded attendance yet.</EmptyLine>
          )}
        </Panel>

        <Panel
          title="What members are here for"
          hint="Roles picked during onboarding, members can pick several"
        >
          {a.roles.length > 0 ? (
            <BarList
              tone="stepped"
              ariaLabel="Interested roles across the membership"
              data={a.roles.slice(0, 6).map((r) => ({
                key: r.key,
                label:
                  INTERESTED_ROLE_LABELS[r.key as InterestedRole] ?? r.key,
                value: r.n,
              }))}
            />
          ) : (
            <EmptyLine>Nobody has picked interests yet.</EmptyLine>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Class standing" hint="Active members only">
          <BarList
            max={m.total}
            ariaLabel="Members by class standing"
            data={standingBars(a.class_standing)}
          />
        </Panel>

        <Panel title="Schools" hint="Top six by headcount">
          <BarList
            max={m.total}
            ariaLabel="Members by school"
            data={a.schools.map((s) => ({
              key: s.key,
              label: s.key,
              value: s.n,
              hint: `${pctOf(s.n)}%`,
            }))}
          />
        </Panel>
      </div>

      <Panel
        title="Pre-platform roster"
        hint="Imported members who have since claimed their account"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {a.legacy.claimed.toLocaleString()}
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              of {a.legacy.total.toLocaleString()} claimed
            </span>
          </p>
          <p className="text-sm tabular-nums text-muted-foreground">
            {a.legacy.total === 0
              ? "0%"
              : `${Math.round((a.legacy.claimed / a.legacy.total) * 100)}%`}
          </p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
          <div
            aria-hidden
            className="h-full rounded-full bg-primary"
            style={{
              width: `${
                a.legacy.total === 0
                  ? 0
                  : Math.round((a.legacy.claimed / a.legacy.total) * 100)
              }%`,
            }}
          />
        </div>
      </Panel>

      {/* Everything below is small/rarely-touched enough that it doesn't
          earn permanent nav real estate — reachable from here instead of
          the sidebar (see admin-nav.tsx). */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <LinkTile label="Export" icon={Download} href="/admin/export" />
        <LinkTile label="Audit log" icon={ScrollText} href="/admin/audit" />
        <LinkTile label="Settings" icon={Settings} href="/admin/settings" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Series shaping
// ---------------------------------------------------------------------------

// Week keys are plain "YYYY-MM-DD" dates with no time component, so they are
// formatted in UTC. Reading them in a US zone would roll each one back a day
// and label the Apr 27 bucket "Apr 26".
const weekLabel = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
const monthLabel = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  month: "short",
});
const monthYearLabel = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

function weeklyColumns(rows: Analytics["signups_weekly"]): ColumnDatum[] {
  return rows.map((r) => {
    const label = weekLabel.format(new Date(`${r.week}T00:00:00Z`));
    return {
      key: r.week,
      label,
      title: `Week of ${label}`,
      value: r.n,
    };
  });
}

function weeklySummary(rows: Analytics["signups_weekly"]): string {
  if (rows.length === 0) return "Weekly signups: no data";
  const peak = rows.reduce((best, r) => (r.n > best.n ? r : best), rows[0]);
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return `Signups per week over ${rows.length} weeks: ${total} total, peaking at ${
    peak.n
  } the week of ${weekLabel.format(new Date(`${peak.week}T00:00:00Z`))}`;
}

function monthlyColumns(rows: Analytics["events_monthly"]): ColumnDatum[] {
  return rows.map((r) => ({
    key: r.month,
    label: monthLabel.format(new Date(`${r.month}-01T00:00:00Z`)),
    title: monthYearLabel.format(new Date(`${r.month}-01T00:00:00Z`)),
    value: r.attendance,
    note: `${r.events} ${r.events === 1 ? "event" : "events"}`,
  }));
}

function monthlySummary(rows: Analytics["events_monthly"]): string {
  const total = rows.reduce((sum, r) => sum + r.attendance, 0);
  const events = rows.reduce((sum, r) => sum + r.events, 0);
  return `Attendance by month over ${rows.length} months: ${total} attendees across ${events} events`;
}

// "unknown" is a real bucket, not a missing one — most of the roster came in
// through the legacy import and never picked a standing. Dropping it would
// make the remaining slices look like the whole membership. It sorts last.
function standingBars(rows: Analytics["class_standing"]): BarDatum[] {
  const named = rows.filter((r) => r.key !== "unknown");
  const unknown = rows.find((r) => r.key === "unknown");
  const bars = named
    .map((r) => ({
      key: r.key,
      label: CLASS_STANDING_LABELS[r.key as ClassStanding] ?? r.key,
      value: r.n,
    }))
    .sort((x, y) => y.value - x.value);
  if (unknown && unknown.n > 0) {
    bars.push({ key: "unknown", label: "Not given", value: unknown.n });
  }
  return bars;
}

function monthYear(iso: string): string {
  return monthYearLabel.format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-foreground">
        {value.toLocaleString()}
        {hint ? (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </dd>
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
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon size={13} strokeWidth={1.75} aria-hidden />
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function ActionTile({
  label,
  value,
  body,
  href,
}: {
  label: string;
  value: number;
  body: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 transition-all duration-200 hover:border-amber-400/60 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <TriangleAlert
        size={16}
        strokeWidth={1.75}
        aria-hidden
        className="mt-0.5 shrink-0 text-amber-300"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums text-amber-100">
            {value.toLocaleString()}
          </span>
          <span className="text-sm font-medium text-amber-100">{label}</span>
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-amber-200/70">
          {body}
        </span>
      </span>
      <ArrowUpRight
        size={14}
        strokeWidth={2}
        aria-hidden
        className="mt-1 shrink-0 text-amber-300/70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function LinkTile({
  label,
  icon: Icon,
  href,
}: {
  label: string;
  icon: LucideIcon;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-black/20 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
        <Icon size={15} strokeWidth={1.75} className="text-muted-foreground" aria-hidden />
        {label}
      </span>
      <ArrowUpRight
        size={14}
        strokeWidth={2}
        aria-hidden
        className="shrink-0 text-muted-foreground/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
}
