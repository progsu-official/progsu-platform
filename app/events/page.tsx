import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, CalendarPlus, History, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { resolveCoverUrls } from "@/lib/events/cover-url";
import {
  getRequestOnboardingState,
  getRequestUser,
} from "@/lib/auth/request-cache";
import { onboardingPathFor } from "@/lib/auth/onboarding";

import { EventCard, joinHosts } from "./_components/event-card";
import {
  EVENT_TIME_ZONE,
  formatTimeRange,
  zonedDayKey,
  zonedDayStartUtcMs,
} from "./_components/event-date";

export const dynamic = "force-dynamic";

type TabKey = "upcoming" | "my-plans" | "past";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "my-plans", label: "My Plans" },
  { key: "past", label: "Past" },
];

// Signed-out visitors get Past as well as Upcoming — it reads through
// public_past_events(), which is anon-safe. Withholding it hid the whole
// backfilled history from exactly the prospective members a 417-person
// turnout is meant to convince. My Plans stays out: it needs a session.
const ANON_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
];

function resolveTab(
  raw: string | undefined,
  allowed: Array<{ key: TabKey }> = TABS
): TabKey {
  return (allowed.find((t) => t.key === raw)?.key ?? "upcoming") as TabKey;
}

function TabNav({ tab, tabs }: { tab: TabKey; tabs: typeof TABS }) {
  return (
    <nav
      aria-label="Event views"
      className="inline-flex items-center gap-0.5 rounded-full glass p-1"
    >
      {tabs.map((t) => {
        const active = t.key === tab;
        return (
          <Link
            key={t.key}
            href={`/events?tab=${t.key}`}
            aria-current={active ? "page" : undefined}
            className={
              "rounded-full px-4 py-1.5 text-sm transition-colors " +
              (active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

type HostRef = { display_name: string; sort_order: number };

type UpcomingRow = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  cover_image_path: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  going_count: number | null;
  waitlisted_count: number | null;
  hosts: HostRef[];
  // When set, the card links straight here (e.g. hacklanta.dev) instead of
  // the internal /events/[slug] page.
  external_url: string | null;
  pinned: boolean;
};

type HistoryRow = {
  event_id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  location_text: string | null;
  cover_image_path: string | null;
  rsvp_status: string | null;
  attended: boolean | null;
  checked_in_at: string | null;
};

// Org-wide past event, from public_past_events(). No capacity/waitlist here:
// those describe seats in a room that has already emptied.
type PastEventRow = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  cover_image_path: string | null;
  going_count: number | null;
  hosts: HostRef[];
};

// The viewer's own relationship to a past event, used only to badge a row.
type MyPastRow = {
  rsvp_status: string | null;
  attended: boolean | null;
  status: string | null;
};

type InviteRow = {
  event_id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  cover_image_path: string | null;
};

export default async function MemberEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // The gate used to live in the shared /events layout, which also wraps the
  // now-public event detail page — moved here so only the member-only tabs
  // (My Plans/Past need an account) stay gated. See app/events/layout.tsx.
  // An anonymous visitor gets the Upcoming tab only — this is the landing
  // page's "Discover Events" entry point, per the 2026-08-20 RSVP-first
  // decision extended to list browsing, not just single event links.
  const user = await getRequestUser();
  const supabase = await createClient();

  if (!user) {
    const { tab: rawAnonTab } = await searchParams;
    const anonTab = resolveTab(rawAnonTab, ANON_TABS);
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-4xl font-bold tracking-tight">Events</h1>
          <TabNav tab={anonTab} tabs={ANON_TABS} />
        </header>
        {anonTab === "past" ? (
          <PastTab supabase={supabase} anon />
        ) : (
          <UpcomingTab supabase={supabase} anon />
        )}
      </div>
    );
  }

  const state = await getRequestOnboardingState(user.id);
  if (!state.isAdmin && !state.fullyOnboarded) {
    redirect(onboardingPathFor(state.nextStep) ?? "/onboarding/verify-email");
  }

  const { tab: rawTab } = await searchParams;
  const tab = resolveTab(rawTab);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight">Events</h1>
        <TabNav tab={tab} tabs={TABS} />
      </header>

      {tab === "upcoming" ? <UpcomingTab supabase={supabase} /> : null}
      {tab === "my-plans" ? <MyPlansTab supabase={supabase} /> : null}
      {tab === "past" ? <PastTab supabase={supabase} /> : null}
    </div>
  );
}

// --------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------

type SupabaseCtx = Awaited<ReturnType<typeof createClient>>;

async function UpcomingTab({
  supabase,
  anon,
}: {
  supabase: SupabaseCtx;
  anon?: boolean;
}) {
  // Anonymous visitors read through public_upcoming_events() instead of the
  // member_visible_events view — same reasoning as public_event_by_slug()
  // (see 20260820180000/20260820200000): base RLS stays authenticated-only,
  // this is a narrow SECURITY DEFINER projection instead.
  const { data, error } = anon
    ? await supabase.rpc("public_upcoming_events", { p_limit: 50 })
    : await supabase
        .from("member_visible_events")
        .select(
          "id, slug, title, starts_at, ends_at, location_text, cover_image_path, capacity, waitlist_enabled, going_count, waitlisted_count, hosts, external_url, pinned"
        )
        .gte("ends_at", new Date().toISOString())
        .order("pinned", { ascending: false })
        .order("starts_at", { ascending: true })
        .limit(50);

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load events: {error.message}
      </p>
    );
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(
    (r): UpcomingRow => ({
      id: r.id as string,
      slug: r.slug as string,
      title: r.title as string,
      starts_at: r.starts_at as string,
      ends_at: r.ends_at as string,
      location_text: (r.location_text as string | null) ?? null,
      cover_image_path: (r.cover_image_path as string | null) ?? null,
      capacity: (r.capacity as number | null) ?? null,
      waitlist_enabled: !!r.waitlist_enabled,
      going_count: (r.going_count as number | null) ?? 0,
      waitlisted_count: (r.waitlisted_count as number | null) ?? 0,
      hosts: (r.hosts as HostRef[] | null) ?? [],
      external_url: (r.external_url as string | null) ?? null,
      pinned: !!r.pinned,
    })
  );
  const coverUrls = await resolveCoverUrls(
    supabase,
    rows.map((r) => r.cover_image_path)
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled yet"
        body="Officers publish events here. Check back soon."
      />
    );
  }

  return (
    <EventTimeline
      items={rows.map((ev, i) => ({
        key: ev.id,
        href: ev.external_url ?? `/events/${ev.slug}`,
        title: ev.title,
        hosts: joinHosts(ev.hosts),
        startsAt: ev.starts_at,
        endsAt: ev.ends_at,
        location: ev.location_text,
        pinned: ev.pinned,
        coverUrl: coverUrls[i] ?? null,
        footer: <CapacityLine ev={ev} />,
      }))}
    />
  );
}

async function MyPlansTab({ supabase }: { supabase: SupabaseCtx }) {
  const nowIso = new Date().toISOString();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: history, error: historyError }, invites] = await Promise.all([
    supabase
      .from("self_event_history")
      .select(
        "event_id, slug, title, starts_at, ends_at, status, location_text, cover_image_path, rsvp_status, attended, checked_in_at"
      )
      .gte("starts_at", nowIso)
      .in("rsvp_status", ["going", "waitlisted"])
      .order("starts_at", { ascending: true }),
    loadInvitedPending(supabase, user?.id ?? null, nowIso),
  ]);

  if (historyError) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load your plans: {historyError.message}
      </p>
    );
  }

  const historyRows = ((history ?? []) as Array<Record<string, unknown>>).map(
    (r): HistoryRow => ({
      event_id: r.event_id as string,
      slug: r.slug as string,
      title: r.title as string,
      starts_at: r.starts_at as string,
      ends_at: r.ends_at as string,
      status: r.status as string,
      location_text: (r.location_text as string | null) ?? null,
      cover_image_path: (r.cover_image_path as string | null) ?? null,
      rsvp_status: (r.rsvp_status as string | null) ?? null,
      attended: (r.attended as boolean | null) ?? null,
      checked_in_at: (r.checked_in_at as string | null) ?? null,
    })
  );

  // De-dupe invites that the user already RSVP'd to (edge case: admin invited
  // after a public RSVP, or a stale pending invite row). history wins.
  const knownIds = new Set(historyRows.map((r) => r.event_id));
  const pendingInvites = invites.filter((i) => !knownIds.has(i.event_id));

  // Batch-sign covers for both sections in a single Promise.all. The helper
  // handles nulls gracefully, so empty arrays just resolve to empty arrays.
  const [historyCoverUrls, inviteCoverUrls] = await Promise.all([
    resolveCoverUrls(
      supabase,
      historyRows.map((r) => r.cover_image_path)
    ),
    resolveCoverUrls(
      supabase,
      pendingInvites.map((r) => r.cover_image_path)
    ),
  ]);

  if (historyRows.length === 0 && pendingInvites.length === 0) {
    return (
      <EmptyState
        icon={CalendarPlus}
        title="You haven't RSVP'd to anything yet"
        body="When you RSVP or get invited, it'll show up here so you don't miss it."
        cta={{ href: "/events?tab=upcoming", label: "Browse upcoming events" }}
      />
    );
  }

  return (
    <div className="space-y-10">
      {pendingInvites.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Needs your response
          </h2>
          <ul className="space-y-4">
            {pendingInvites.map((ev, i) => (
              <EventCard
                key={ev.event_id}
                href={`/events/${ev.slug}`}
                title={ev.title}
                hosts={null}
                startsAt={ev.starts_at}
                endsAt={ev.ends_at}
                location={ev.location_text}
                coverUrl={inviteCoverUrls[i] ?? null}
                showDate
                footer={<Badge tone="invite">Invited · RSVP</Badge>}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <EventTimeline
        items={historyRows.map((ev, i) => ({
          key: ev.event_id,
          href: `/events/${ev.slug}`,
          title: ev.title,
          hosts: null,
          startsAt: ev.starts_at,
          endsAt: ev.ends_at,
          location: ev.location_text,
          cancelled: ev.status === "cancelled",
          coverUrl: historyCoverUrls[i] ?? null,
          footer:
            ev.rsvp_status === "going" ? (
              <Badge tone="primary">Going</Badge>
            ) : ev.rsvp_status === "waitlisted" ? (
              <Badge tone="amber">Waitlisted</Badge>
            ) : null,
        }))}
      />
    </div>
  );
}

async function loadInvitedPending(
  supabase: SupabaseCtx,
  userId: string | null,
  nowIso: string
): Promise<InviteRow[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("event_invites")
    .select(
      "event_id, events!inner(slug, title, status, starts_at, ends_at, location_text, cover_image_path)"
    )
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error || !data) return [];

  type InviteEvent = {
    slug: string;
    title: string;
    status: string;
    starts_at: string;
    ends_at: string;
    location_text: string | null;
    cover_image_path: string | null;
  };
  type InviteWithEvent = {
    event_id: string;
    events: InviteEvent | InviteEvent[] | null;
  };
  const rows: InviteRow[] = [];
  for (const raw of data as Array<Record<string, unknown>>) {
    const row = raw as unknown as InviteWithEvent;
    const rel = row.events;
    const ev = Array.isArray(rel) ? rel[0] : rel;
    if (!ev) continue;
    if (ev.status !== "published") continue;
    if (ev.starts_at < nowIso) continue;
    rows.push({
      event_id: row.event_id,
      slug: ev.slug,
      title: ev.title,
      starts_at: ev.starts_at,
      ends_at: ev.ends_at,
      location_text: ev.location_text,
      cover_image_path: ev.cover_image_path,
    });
  }
  rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return rows;
}

async function PastTab({
  supabase,
  anon,
}: {
  supabase: SupabaseCtx;
  anon?: boolean;
}) {
  // Org-wide, not self-scoped. This tab used to read self_event_history,
  // which joins on auth.uid() and keeps only events the viewer personally
  // RSVP'd to or checked into — so it answered "what did I go to", never
  // "what has progsu run". With three live RSVPs and no attendance rows on
  // the platform it rendered empty for everyone, which also meant the
  // backfilled Luma-era events were reachable by URL and listed nowhere.
  //
  // public_past_events() is the org-wide list; self_event_history is still
  // read alongside it, but only to badge the rows the viewer was part of.
  const nowIso = new Date().toISOString();
  const [{ data, error }, { data: mineRaw }] = await Promise.all([
    supabase.rpc("public_past_events", { p_limit: 50 }),
    anon
      ? Promise.resolve({ data: null })
      : supabase
          .from("self_event_history")
          .select("event_id, rsvp_status, attended, status")
          .lt("ends_at", nowIso),
  ]);

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load past events: {error.message}
      </p>
    );
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(
    (r): PastEventRow => ({
      id: r.id as string,
      slug: r.slug as string,
      title: r.title as string,
      starts_at: r.starts_at as string,
      ends_at: r.ends_at as string,
      location_text: (r.location_text as string | null) ?? null,
      cover_image_path: (r.cover_image_path as string | null) ?? null,
      going_count: (r.going_count as number | null) ?? 0,
      hosts: (r.hosts as HostRef[] | null) ?? [],
    })
  );

  const mine = new Map<string, MyPastRow>();
  for (const raw of (mineRaw ?? []) as Array<Record<string, unknown>>) {
    mine.set(raw.event_id as string, {
      rsvp_status: (raw.rsvp_status as string | null) ?? null,
      attended: (raw.attended as boolean | null) ?? null,
      status: (raw.status as string | null) ?? null,
    });
  }

  const pastCoverUrls = await resolveCoverUrls(
    supabase,
    rows.map((r) => r.cover_image_path)
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No past events yet"
        body="Events show up here once they have wrapped."
        cta={{ href: "/events?tab=upcoming", label: "See what's coming up" }}
      />
    );
  }

  return (
    <EventTimeline
      items={rows.map((ev, i) => ({
        key: ev.id,
        href: `/events/${ev.slug}`,
        title: ev.title,
        hosts: joinHosts(ev.hosts),
        startsAt: ev.starts_at,
        endsAt: ev.ends_at,
        location: ev.location_text,
        coverUrl: pastCoverUrls[i] ?? null,
        footer: (
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums text-muted-foreground">
              {(ev.going_count ?? 0).toLocaleString()} went
            </span>
            {buildPastBadge(mine.get(ev.id))}
          </span>
        ),
      }))}
    />
  );
}

function buildPastBadge(mine: MyPastRow | undefined) {
  if (!mine) return null;
  if (mine.status === "cancelled") {
    return <Badge tone="destructive">Cancelled</Badge>;
  }
  if (mine.attended) {
    return <Badge tone="primary">You attended</Badge>;
  }
  if (mine.rsvp_status === "going") {
    return <Badge tone="muted">No check-in</Badge>;
  }
  if (mine.rsvp_status === "waitlisted") {
    return <Badge tone="muted">Waitlisted</Badge>;
  }
  if (mine.rsvp_status === "declined") {
    return <Badge tone="muted">You declined</Badge>;
  }
  if (mine.rsvp_status === "cancelled") {
    return <Badge tone="muted">You cancelled</Badge>;
  }
  return null;
}

// --------------------------------------------------------------------
// Timeline
// --------------------------------------------------------------------

type TimelineItem = {
  key: string;
  href: string;
  title: string;
  hosts: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  cancelled?: boolean;
  pinned?: boolean;
  coverUrl: string | null;
  footer?: React.ReactNode;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  weekday: "long",
});
const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
  day: "numeric",
});

// "Today / Wednesday", "Tomorrow / Thursday", "Friday / Aug 21",
// "Aug 25 / Monday" — mirrors Luma's date rail. Diffed in EVENT_TIME_ZONE,
// not the ambient runtime zone (UTC on the server, viewer's device on the
// client) — otherwise events near midnight Eastern could land under the
// wrong day, same bug as the raw-UTC event times.
function dayLabels(day: Date, now: Date): [string, string] {
  const diffDays = Math.round(
    (zonedDayStartUtcMs(day) - zonedDayStartUtcMs(now)) / MS_PER_DAY
  );
  const weekday = weekdayFormatter.format(day);
  const monthDay = monthDayFormatter.format(day);
  if (diffDays === 0) return ["Today", weekday];
  if (diffDays === 1) return ["Tomorrow", weekday];
  if (diffDays > 1 && diffDays < 7) return [weekday, monthDay];
  return [monthDay, weekday];
}

// Groups items by calendar day (preserving incoming order) and renders the
// Luma-style rail: day labels on the left, dotted spine, cards on the right.
// Pinned items skip the rail entirely — they're not "next in line", they're
// promoted, so they render as their own hero(es) above it instead of a
// ribbon bolted onto a regular row (see 2026-08-23 design pass).
function EventTimeline({ items }: { items: TimelineItem[] }) {
  const pinnedItems = items.filter((item) => item.pinned);
  const restItems = items.filter((item) => !item.pinned);
  const now = new Date();
  const groups: Array<{ dayKey: string; day: Date; items: TimelineItem[] }> = [];
  for (const item of restItems) {
    const day = new Date(item.startsAt);
    const dayKey = zonedDayKey(day);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.items.push(item);
    } else {
      groups.push({ dayKey, day, items: [item] });
    }
  }

  return (
    <div className="space-y-8">
      {pinnedItems.length > 0 ? (
        <div className="space-y-4">
          {pinnedItems.map((item) => (
            <PinnedEventHero key={item.key} item={item} />
          ))}
        </div>
      ) : null}
      {groups.length > 0 ? <EventDayRail groups={groups} now={now} /> : null}
    </div>
  );
}

// Featured promo card: bigger cover, bold CTA, its own visual language
// (primary-tinted surface) so it reads as "we're pushing this" rather than
// just another row in the day list.
function PinnedEventHero({ item }: { item: TimelineItem }) {
  const dateLabel = `${monthDayFormatter.format(new Date(item.startsAt))} · ${formatTimeRange(item.startsAt, item.endsAt)}`;
  return (
    <Link
      href={item.href}
      className="group flex flex-col gap-4 overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-5 shadow-lg shadow-primary/5 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:flex-row sm:items-start sm:gap-6 sm:p-6"
    >
      <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-muted to-primary/30 sm:h-32 sm:w-48">
        {item.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.coverUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <CalendarDays size={28} strokeWidth={1.5} className="text-muted-foreground/60" aria-hidden />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <h2 className="text-2xl font-bold tracking-tight text-foreground transition-colors group-hover:text-primary sm:text-3xl">
            {item.title}
          </h2>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold uppercase leading-none tracking-wide text-primary-foreground">
            <Sparkles size={14} strokeWidth={2} aria-hidden />
            Featured
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
        {item.hosts ? <p className="text-sm text-muted-foreground">By {item.hosts}</p> : null}
        <p className="text-sm font-semibold text-amber-500">
          RSVPs open, slots are limited!
        </p>
      </div>
    </Link>
  );
}

function EventDayRail({
  groups,
  now,
}: {
  groups: Array<{ dayKey: string; day: Date; items: TimelineItem[] }>;
  now: Date;
}) {
  return (
    <section className="relative">
      <div
        aria-hidden
        className="absolute bottom-6 top-2 hidden border-l border-dashed border-border sm:left-[8.25rem] sm:block"
      />
      <ol>
        {groups.map(({ dayKey, day, items: dayItems }) => {
        const [primary, secondary] = dayLabels(day, now);
        return (
          <li
            key={dayKey}
            className="relative pb-10 last:pb-0 sm:grid sm:grid-cols-[7.25rem_1fr] sm:gap-9"
          >
            <span
              aria-hidden
              className="absolute top-2 hidden h-2 w-2 rounded-full bg-muted-foreground/40 sm:left-[calc(8.25rem-4px)] sm:block"
            />
            <div className="mb-3 flex items-baseline gap-2 sm:mb-0 sm:block sm:self-start">
              <p className="text-base font-semibold text-foreground">
                {primary}
              </p>
              <p className="text-sm text-muted-foreground">{secondary}</p>
            </div>
            <ul className="space-y-4">
              {dayItems.map((item) => (
                <EventCard
                  key={item.key}
                  href={item.href}
                  title={item.title}
                  hosts={item.hosts}
                  startsAt={item.startsAt}
                  endsAt={item.endsAt}
                  location={item.location}
                  cancelled={item.cancelled}
                  coverUrl={item.coverUrl}
                  footer={item.footer}
                />
              ))}
            </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// --------------------------------------------------------------------
// Presentational helpers
// --------------------------------------------------------------------

function CapacityLine({ ev }: { ev: UpcomingRow }) {
  const going = ev.going_count ?? 0;
  if (ev.capacity === null) {
    return <span className="text-muted-foreground">{going} going</span>;
  }
  const full = going >= ev.capacity;
  return (
    <span className="text-muted-foreground">
      {going} of {ev.capacity} going
      {full && ev.waitlist_enabled ? (
        <>
          {" · "}
          <span>Waitlist: {ev.waitlisted_count ?? 0}</span>
        </>
      ) : null}
    </span>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "primary" | "amber" | "destructive" | "muted" | "invite";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary/15 text-primary"
      : tone === "amber"
        ? "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
        : tone === "destructive"
          ? "bg-destructive/15 text-destructive"
          : tone === "invite"
            ? "bg-indigo-500/15 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300"
            : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneClass}`}
    >
      {children}
    </span>
  );
}

function EmptyState({
  title,
  body,
  cta,
  icon: Icon,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border/80 px-8 py-14 text-center">
      {Icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
          <Icon size={20} className="text-muted-foreground" strokeWidth={1.5} />
        </div>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-4 inline-block rounded-full border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/60"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
