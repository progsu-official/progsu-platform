import Link from "next/link";
import { BarChart3, CalendarDays, Plus } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCoverUrls } from "@/lib/events/cover-url";
import { EventCard, joinHosts } from "@/app/events/_components/event-card";

import { StatusFilterSelect } from "./status-filter-select";

export const dynamic = "force-dynamic";

type TabKey = "all" | "draft" | "published" | "past" | "cancelled" | "archived";

// "published" stays the DB status/TabKey value (matches public.event_status_t
// and every existing filter/default below) — only the displayed label reads
// "Active", and this array's order drives the filter dropdown order too.
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "published", label: "Active" },
  { key: "draft", label: "Draft" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
  { key: "archived", label: "Archived" },
];

const PAGE_SIZE = 25;
const MAX_PAGE = 1000;

type SearchParams = {
  tab?: string;
  page?: string;
};

function resolveTab(raw: string | undefined): TabKey {
  if (!raw) return "all";
  return (TABS.find((t) => t.key === raw)?.key ?? "all") as TabKey;
}

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tab = resolveTab(params.tab);
  const page = Math.min(
    Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1),
    MAX_PAGE
  );

  const admin = createAdminClient();

  // Past = published events with ends_at < now(). Everything else filters on
  // the status enum directly. We keep the logic here so the page is
  // self-contained; no DB view needed.
  let query = admin
    .from("events")
    .select(
      "id, slug, title, status, visibility, starts_at, ends_at, location_text, cover_image_path, capacity, waitlist_enabled",
      { count: "exact" }
    )
    .order("starts_at", { ascending: false });

  const nowIso = new Date().toISOString();
  if (tab === "all") {
    // "All" reads as "everything you'd actually manage" — archived events
    // already have their own tab, so surfacing them here too just buries
    // active/draft/past events under old ones. (2026-08-22, per John)
    query = query.neq("status", "archived");
  } else if (tab === "past") {
    query = query.eq("status", "published").lt("ends_at", nowIso);
  } else if (tab === "published") {
    query = query.eq("status", "published").gte("ends_at", nowIso);
  } else if (tab === "draft") {
    query = query.eq("status", "draft");
  } else if (tab === "cancelled") {
    query = query.eq("status", "cancelled");
  } else if (tab === "archived") {
    query = query.eq("status", "archived");
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data: rows, count, error } = await query.range(from, to);

  const ids = (rows ?? []).map((r) => r.id as string);

  // RSVP counts and hosts — load for visible ids in one query each, then
  // group in JS. Avoids a per-row join that would blow up the plan.
  const rsvpCountByEvent = new Map<string, { going: number; waitlisted: number }>();
  const hostsByEvent = new Map<string, Array<{ display_name: string; sort_order: number }>>();
  if (ids.length > 0) {
    const [{ data: rsvps }, { data: hosts }, { data: historicalCounts }] =
      await Promise.all([
        admin
          .from("event_rsvps")
          .select("event_id, status")
          .in("event_id", ids)
          .in("status", ["going", "waitlisted"]),
        admin
          .from("event_hosts")
          .select("event_id, display_name, sort_order")
          .in("event_id", ids),
        // Historical (pre-platform) events have no event_rsvps rows at all —
        // approval_status='approved' is the historical equivalent of "going"
        // (see supabase/migrations/20260821030000_*). Aggregated in Postgres
        // (not fetched raw + counted in JS): historical_event_attendances can
        // run into the thousands of rows, well past PostgREST's default
        // response cap, which was silently truncating the raw fetch and
        // undercounting well-attended historical events.
        admin.rpc("historical_attendance_counts", { p_event_ids: ids }),
      ]);
    for (const r of rsvps ?? []) {
      const id = r.event_id as string;
      const entry = rsvpCountByEvent.get(id) ?? { going: 0, waitlisted: 0 };
      if (r.status === "going") entry.going += 1;
      else if (r.status === "waitlisted") entry.waitlisted += 1;
      rsvpCountByEvent.set(id, entry);
    }
    for (const c of historicalCounts ?? []) {
      const id = c.event_id as string;
      const entry = rsvpCountByEvent.get(id) ?? { going: 0, waitlisted: 0 };
      entry.going += c.going_count as number;
      rsvpCountByEvent.set(id, entry);
    }
    for (const h of hosts ?? []) {
      const id = h.event_id as string;
      const list = hostsByEvent.get(id) ?? [];
      list.push({
        display_name: h.display_name as string,
        sort_order: (h.sort_order as number | null) ?? 0,
      });
      hostsByEvent.set(id, list);
    }
  }

  const coverUrls = await resolveCoverUrls(
    admin,
    (rows ?? []).map((r) => (r.cover_image_path as string | null) ?? null)
  );

  const totalPages = Math.min(
    Math.ceil((count ?? 0) / PAGE_SIZE) || 1,
    MAX_PAGE
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <div className="flex flex-wrap items-center gap-4">
          <StatusFilterSelect tabs={TABS} active={tab} />
          <Link
            href="/admin/events/analytics"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <BarChart3 size={15} strokeWidth={1.75} aria-hidden />
            Analytics
          </Link>
          <Link
            href="/admin/events/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={15} strokeWidth={2} aria-hidden />
            Create event
          </Link>
        </div>
      </header>

      {error ? (
        <p className="text-sm text-destructive">Query error: {error.message}</p>
      ) : null}

      {(rows ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 px-8 py-14 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
            <CalendarDays size={20} className="text-muted-foreground" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-foreground">No events in this tab yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {(rows ?? []).map((r, i) => {
            const id = r.id as string;
            const counts = rsvpCountByEvent.get(id) ?? { going: 0, waitlisted: 0 };
            const capacity = r.capacity as number | null;
            const waitlistEnabled = !!r.waitlist_enabled;
            return (
              <EventCard
                key={id}
                variant="admin"
                href={`/admin/events/${id}`}
                title={r.title as string}
                hosts={joinHosts(hostsByEvent.get(id))}
                startsAt={r.starts_at as string}
                endsAt={r.ends_at as string}
                location={(r.location_text as string | null) ?? null}
                cancelled={r.status === "cancelled"}
                coverUrl={coverUrls[i] ?? null}
                showDate
                footer={
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">
                      {counts.going} going
                      {capacity !== null ? ` / ${capacity} cap` : ""}
                      {waitlistEnabled && counts.waitlisted > 0
                        ? ` · ${counts.waitlisted} waitlisted`
                        : ""}
                    </span>
                    <StatusBadge
                      status={r.status as string}
                      past={
                        r.status === "published" &&
                        new Date(r.ends_at as string) < new Date()
                      }
                    />
                    {r.visibility === "private_invite" ? (
                      <span className="text-muted-foreground">· Invite-only</span>
                    ) : null}
                  </div>
                }
              />
            );
          })}
        </ul>
      )}

      <Pagination page={page} totalPages={totalPages} tab={tab} />
    </div>
  );
}

function StatusBadge({
  status,
  past,
}: {
  status: string;
  past?: boolean;
}) {
  const tone =
    status === "published"
      ? past
        ? "bg-muted text-muted-foreground"
        : "bg-primary/10 text-primary"
      : status === "draft"
        ? "bg-muted text-muted-foreground"
        : status === "cancelled"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground";
  // "published" displays as "active" everywhere on this page — same status
  // value underneath, matches the tab nav's "Active" label above. A
  // published event whose end time has passed reads "past" instead: the
  // status column never actually flips to a "past" DB value, ends_at just
  // moves behind now(), so the badge has to compute it the same way the
  // tab filter above does.
  const label = status === "published" ? (past ? "past" : "active") : status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

function Pagination({
  page,
  totalPages,
  tab,
}: {
  page: number;
  totalPages: number;
  tab: string;
}) {
  const link = (p: number) =>
    `/admin/events?tab=${encodeURIComponent(tab)}&page=${p}`;
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <a
            href={link(page - 1)}
            className="rounded-md border border-input px-3 py-1 hover:bg-accent/10"
          >
            Prev
          </a>
        ) : null}
        {page < totalPages ? (
          <a
            href={link(page + 1)}
            className="rounded-md border border-input px-3 py-1 hover:bg-accent/10"
          >
            Next
          </a>
        ) : null}
      </div>
    </div>
  );
}
