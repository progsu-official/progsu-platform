import Link from "next/link";
import { CalendarDays, CalendarPlus, History, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { resolveCoverUrls } from "@/lib/events/cover-url";

import { EventDate } from "./_components/event-date";

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
  return sorted.map((h) => h.display_name).join(" · ");
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted-foreground">
            Browse upcoming Progsu events, your plans, and past attendance.
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 border-b text-sm">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/events?tab=${t.key}`}
              className={
                "-mb-px border-b-2 px-3 py-2 " +
                (active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

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
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {rows.map((ev, i) => (
        <EventCard
          key={ev.id}
          href={`/events/${ev.slug}`}
          title={ev.title}
          hosts={joinHosts(ev.hosts)}
          startsAt={ev.starts_at}
          endsAt={ev.ends_at}
          location={ev.location_text}
          coverUrl={coverUrls[i] ?? null}
          footer={<CapacityLine ev={ev} />}
        />
      ))}
    </ul>
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
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {historyRows.map((ev, i) => {
        const badge =
          ev.rsvp_status === "going" ? (
            <Badge tone="primary">Going</Badge>
          ) : ev.rsvp_status === "waitlisted" ? (
            <Badge tone="amber">Waitlisted</Badge>
          ) : null;
        return (
          <EventCard
            key={ev.event_id}
            href={`/events/${ev.slug}`}
            title={ev.title}
            hosts={null}
            startsAt={ev.starts_at}
            endsAt={ev.ends_at}
            location={ev.location_text}
            cancelled={ev.status === "cancelled"}
            coverUrl={historyCoverUrls[i] ?? null}
            footer={badge}
          />
        );
      })}
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
          footer={<Badge tone="muted">Invited</Badge>}
        />
      ))}
    </ul>
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
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {rows.map((ev, i) => {
        const badge = buildPastBadge(ev);
        return (
          <EventCard
            key={ev.event_id}
            href={`/events/${ev.slug}`}
            title={ev.title}
            hosts={null}
            startsAt={ev.starts_at}
            endsAt={ev.ends_at}
            location={ev.location_text}
            cancelled={ev.status === "cancelled"}
            coverUrl={pastCoverUrls[i] ?? null}
            footer={badge}
          />
        );
      })}
    </ul>
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
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex h-full flex-col overflow-hidden rounded-md border transition-colors hover:border-primary hover:bg-accent/5"
      >
        <div className="relative aspect-[3/1] w-full bg-gradient-to-br from-muted to-accent/30">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
          {cancelled ? (
            <div className="absolute inset-x-0 bottom-0 bg-destructive/85 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-destructive-foreground">
              Cancelled
            </div>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col justify-between gap-3 p-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold leading-snug text-foreground group-hover:text-primary">
              {title}
            </h2>
            {hosts ? (
              <p className="text-xs text-muted-foreground">{hosts}</p>
            ) : null}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays size={12} strokeWidth={1.75} />
              <EventDate startsAt={startsAt} endsAt={endsAt} />
            </p>
            {location ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin size={12} strokeWidth={1.75} />
                <span className="truncate">{location}</span>
              </p>
            ) : null}
          </div>
          {footer ? <div className="text-xs">{footer}</div> : null}
        </div>
      </Link>
    </li>
  );
}

function CapacityLine({ ev }: { ev: UpcomingRow }) {
  const going = ev.going_count ?? 0;
  if (ev.capacity === null) {
    return (
      <span className="text-muted-foreground">
        {going} going
      </span>
    );
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
  tone: "primary" | "amber" | "destructive" | "muted";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "amber"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : tone === "destructive"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClass}`}
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
    <div className="rounded-md border border-dashed p-8 text-center">
      {Icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
          <Icon size={20} className="text-muted-foreground" strokeWidth={1.5} />
        </div>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-3 inline-block text-sm text-primary underline underline-offset-4"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
