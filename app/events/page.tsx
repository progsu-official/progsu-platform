import Link from "next/link";
import { CalendarDays, CalendarPlus, History, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { resolveCoverUrls } from "@/lib/events/cover-url";

import { formatTimeRange } from "./_components/event-date";

export const dynamic = "force-dynamic";

type TabKey = "upcoming" | "my-plans" | "past";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "my-plans", label: "My Plans" },
  { key: "past", label: "Past" },
];

function resolveTab(raw: string | undefined): TabKey {
  return (TABS.find((t) => t.key === raw)?.key ?? "upcoming") as TabKey;
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

type InviteRow = {
  event_id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  cover_image_path: string | null;
};

function joinHosts(hosts: HostRef[] | null | undefined): string | null {
  if (!hosts || hosts.length === 0) return null;
  const sorted = [...hosts].sort((a, b) => a.sort_order - b.sort_order);
  return sorted.map((h) => h.display_name).join(", ");
}

export default async function MemberEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab = resolveTab(rawTab);
  const supabase = await createClient();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight">Events</h1>
        <nav
          aria-label="Event views"
          className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-card p-1"
        >
          {TABS.map((t) => {
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

async function UpcomingTab({ supabase }: { supabase: SupabaseCtx }) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("member_visible_events")
    .select(
      "id, slug, title, starts_at, ends_at, location_text, cover_image_path, capacity, waitlist_enabled, going_count, waitlisted_count, hosts"
    )
    .gte("ends_at", nowIso)
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
        href: `/events/${ev.slug}`,
        title: ev.title,
        hosts: joinHosts(ev.hosts),
        startsAt: ev.starts_at,
        endsAt: ev.ends_at,
        location: ev.location_text,
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

async function PastTab({ supabase }: { supabase: SupabaseCtx }) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("self_event_history")
    .select(
      "event_id, slug, title, starts_at, ends_at, status, location_text, cover_image_path, rsvp_status, attended, checked_in_at"
    )
    .lt("ends_at", nowIso)
    .order("starts_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load your history: {error.message}
      </p>
    );
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(
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
  const pastCoverUrls = await resolveCoverUrls(
    supabase,
    rows.map((r) => r.cover_image_path)
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No event history yet"
        body="Events you attend will appear here after they end."
        cta={{ href: "/events?tab=upcoming", label: "See what's coming up" }}
      />
    );
  }

  return (
    <EventTimeline
      items={rows.map((ev, i) => ({
        key: ev.event_id,
        href: `/events/${ev.slug}`,
        title: ev.title,
        hosts: null,
        startsAt: ev.starts_at,
        endsAt: ev.ends_at,
        location: ev.location_text,
        cancelled: ev.status === "cancelled",
        coverUrl: pastCoverUrls[i] ?? null,
        footer: buildPastBadge(ev),
      }))}
    />
  );
}

function buildPastBadge(ev: HistoryRow) {
  if (ev.status === "cancelled") {
    return <Badge tone="destructive">Cancelled</Badge>;
  }
  if (ev.attended) {
    return <Badge tone="primary">Attended</Badge>;
  }
  if (ev.rsvp_status === "going") {
    return <Badge tone="muted">No check-in</Badge>;
  }
  if (ev.rsvp_status === "waitlisted") {
    return <Badge tone="muted">Waitlisted</Badge>;
  }
  if (ev.rsvp_status === "declined") {
    return <Badge tone="muted">You declined</Badge>;
  }
  if (ev.rsvp_status === "cancelled") {
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
  coverUrl: string | null;
  footer?: React.ReactNode;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
});
const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

// "Today / Wednesday", "Tomorrow / Thursday", "Friday / Aug 21",
// "Aug 25 / Monday" — mirrors Luma's date rail.
function dayLabels(day: Date, now: Date): [string, string] {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(day) - startOfDay(now)) / MS_PER_DAY);
  const weekday = weekdayFormatter.format(day);
  const monthDay = monthDayFormatter.format(day);
  if (diffDays === 0) return ["Today", weekday];
  if (diffDays === 1) return ["Tomorrow", weekday];
  if (diffDays > 1 && diffDays < 7) return [weekday, monthDay];
  return [monthDay, weekday];
}

// Groups items by calendar day (preserving incoming order) and renders the
// Luma-style rail: day labels on the left, dotted spine, cards on the right.
function EventTimeline({ items }: { items: TimelineItem[] }) {
  const now = new Date();
  const groups: Array<{ dayKey: string; day: Date; items: TimelineItem[] }> = [];
  for (const item of items) {
    const day = new Date(item.startsAt);
    const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.items.push(item);
    } else {
      groups.push({ dayKey, day, items: [item] });
    }
  }

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

function EventCard({
  href,
  title,
  hosts,
  startsAt,
  endsAt,
  location,
  cancelled,
  coverUrl,
  footer,
  showDate,
}: {
  href: string;
  title: string;
  hosts: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  cancelled?: boolean;
  coverUrl?: string | null;
  footer?: React.ReactNode;
  showDate?: boolean;
}) {
  const timeLabel = showDate
    ? `${monthDayFormatter.format(new Date(startsAt))} · ${formatTimeRange(startsAt, endsAt)}`
    : formatTimeRange(startsAt, endsAt);
  return (
    <li className="list-none">
      <Link
        href={href}
        className="group flex gap-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-lg hover:shadow-black/20"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm text-muted-foreground">
            <time dateTime={startsAt}>{timeLabel}</time>
          </p>
          <h3
            className={
              "text-lg font-semibold leading-snug transition-colors group-hover:text-primary " +
              (cancelled ? "text-muted-foreground line-through" : "text-foreground")
            }
          >
            {title}
          </h3>
          {hosts ? (
            <p className="truncate text-sm text-muted-foreground">By {hosts}</p>
          ) : null}
          {location ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span className="truncate">{location}</span>
            </p>
          ) : null}
          {footer ? <div className="pt-1.5 text-xs">{footer}</div> : null}
        </div>
        <div
          className={
            "relative h-24 w-24 shrink-0 self-start overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-muted to-primary/20 sm:h-[6.5rem] sm:w-[6.5rem] " +
            (cancelled ? "opacity-50 grayscale" : "")
          }
        >
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <CalendarDays
                size={22}
                strokeWidth={1.5}
                className="text-muted-foreground/60"
                aria-hidden
              />
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

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
        ? "bg-amber-400/15 text-amber-300"
        : tone === "destructive"
          ? "bg-destructive/15 text-destructive"
          : tone === "invite"
            ? "bg-indigo-400/15 text-indigo-300"
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
