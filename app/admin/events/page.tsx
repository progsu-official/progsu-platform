import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type TabKey = "draft" | "published" | "past" | "cancelled" | "archived";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "draft", label: "Draft" },
  { key: "published", label: "Published" },
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
  if (!raw) return "published";
  return (TABS.find((t) => t.key === raw)?.key ?? "published") as TabKey;
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
      "id, slug, title, status, visibility, starts_at, ends_at, capacity, waitlist_enabled, published_at, cancelled_at, archived_at",
      { count: "exact" }
    )
    .order("starts_at", { ascending: false });

  const nowIso = new Date().toISOString();
  if (tab === "past") {
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

  // RSVP counts — load for visible ids in one query, then group in JS. Avoids a
  // per-row join that would blow up the plan.
  const ids = (rows ?? []).map((r) => r.id as string);
  const rsvpCountByEvent = new Map<string, { going: number; waitlisted: number }>();
  if (ids.length > 0) {
    const { data: rsvps } = await admin
      .from("event_rsvps")
      .select("event_id, status")
      .in("event_id", ids)
      .in("status", ["going", "waitlisted"]);
    for (const r of rsvps ?? []) {
      const id = r.event_id as string;
      const entry = rsvpCountByEvent.get(id) ?? { going: 0, waitlisted: 0 };
      if (r.status === "going") entry.going += 1;
      else if (r.status === "waitlisted") entry.waitlisted += 1;
      rsvpCountByEvent.set(id, entry);
    }
  }

  const totalPages = Math.min(
    Math.ceil((count ?? 0) / PAGE_SIZE) || 1,
    MAX_PAGE
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-xs text-muted-foreground">
            {count ?? 0} {tab} event{count === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/admin/events/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create event
        </Link>
      </header>

      <nav className="flex flex-wrap gap-1 border-b text-sm">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/admin/events?tab=${t.key}`}
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

      {error ? (
        <p className="text-sm text-destructive">Query error: {error.message}</p>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Slug</th>
              <th className="px-3 py-2 font-medium">Starts</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Visibility</th>
              <th className="px-3 py-2 font-medium">Going / Waitlist</th>
              <th className="px-3 py-2 font-medium">Capacity</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(rows ?? []).map((r) => {
              const id = r.id as string;
              const counts = rsvpCountByEvent.get(id) ?? {
                going: 0,
                waitlisted: 0,
              };
              return (
                <tr key={id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/events/${id}`}
                      className="text-primary hover:underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {r.slug}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(r.starts_at as string).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status as string} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {(r.visibility as string)?.replace("_", " ")}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {counts.going}
                    {r.waitlist_enabled ? ` / ${counts.waitlisted}` : ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.capacity ?? "—"}
                  </td>
                </tr>
              );
            })}
            {(rows ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No events in this tab yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} tab={tab} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "published"
      ? "bg-primary/10 text-primary"
      : status === "draft"
        ? "bg-muted text-muted-foreground"
        : status === "cancelled"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
    >
      {status}
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
