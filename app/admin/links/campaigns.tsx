"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Archive,
  ArrowUpRight,
  Check,
  Copy,
  Link2,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createReferralLink,
  setReferralLinkArchived,
} from "@/lib/actions/referrals";
import type {
  ReferralCampaignDashboard,
  ReferralCampaignRow,
  ReferralEventOption,
} from "@/lib/actions/referrals-schemas";
import { BarList, Funnel, Panel } from "@/app/admin/_components/charts";
import { TimeSeriesChart } from "@/app/admin/_components/time-series-chart";

// Campaign links across every event.
//
// Same aggregate-only construction as the per-event tab: referral_link_hits
// holds no identifier for anyone (migration 20260824150000), so there is no
// drill-down to build here because there is nothing to drill into.
//
// The one view this page has that the per-event tab cannot is the channel
// ranking — every link we have ever run, sorted by conversions rather than
// clicks. That ordering is the whole argument: a flyer with 9 RSVPs from 60
// clicks beat a Discord post with 200 clicks and 2, and ranking by clicks
// says the opposite.

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function relative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function CampaignsDashboard({
  data,
  error,
  origin,
  days,
  dayRanges,
}: {
  data: ReferralCampaignDashboard | null;
  error: string | null;
  origin: string;
  days: number;
  dayRanges: number[];
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [eventFilter, setEventFilter] = useState<string>("all");

  // Memoised rather than inlined as `data?.links ?? []`: that expression is a
  // fresh array on every render, which makes it a changing dependency of all
  // three useMemos below and defeats them entirely.
  const links = useMemo(() => data?.links ?? [], [data?.links]);
  const totals = data?.totals;

  const filtered = useMemo(() => {
    return links.filter((l) => {
      if (!showArchived && l.archived_at) return false;
      if (eventFilter !== "all" && l.event_id !== eventFilter) return false;
      return true;
    });
  }, [links, showArchived, eventFilter]);

  // Events that actually carry a campaign, for the filter dropdown. The
  // create form uses the full list instead — you make the first link for an
  // event that has none, by definition.
  const eventsWithLinks = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of links) seen.set(l.event_id, l.event_title);
    return [...seen.entries()];
  }, [links]);

  const byEvent = useMemo(() => {
    const groups = new Map<string, ReferralCampaignRow[]>();
    for (const l of filtered) {
      groups.set(l.event_id, [...(groups.get(l.event_id) ?? []), l]);
    }
    return [...groups.values()].sort(
      (a, b) =>
        new Date(b[0].event_starts_at).getTime() -
        new Date(a[0].event_starts_at).getTime()
    );
  }, [filtered]);

  const ranking = useMemo(
    () =>
      links
        .filter((l) => l.clicks > 0 || l.rsvps > 0)
        .sort((a, b) => b.rsvps - a.rsvps || b.visitors - a.visitors)
        .slice(0, 8)
        .map((l) => ({
          key: l.id,
          label: l.label,
          value: l.rsvps,
          hint: `${l.visitors} visitor${l.visitors === 1 ? "" : "s"}`,
        })),
    [links]
  );

  const series = useMemo(
    () =>
      (data?.daily ?? []).map((d) => ({
        key: d.day,
        label: dayFormat.format(new Date(`${d.day}T00:00:00Z`)),
        title: dayFormat.format(new Date(`${d.day}T00:00:00Z`)),
        value: d.clicks,
        note:
          d.rsvps > 0
            ? `${d.rsvps} RSVP${d.rsvps === 1 ? "" : "s"} · ${d.visitors} visitors`
            : `${d.visitors} visitor${d.visitors === 1 ? "" : "s"}`,
      })),
    [data?.daily]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Campaign links
        </h1>
        <p className="text-sm text-muted-foreground">
          One short link per channel, per event. The link records the click and
          sets an attribution cookie, so the RSVP that follows is credited to
          whatever brought them.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <CreateCampaignForm events={data?.events ?? []} origin={origin} />

      {totals ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Funnel"
            hint={`${totals.active} active link${totals.active === 1 ? "" : "s"} across every event`}
          >
            <Funnel
              ariaLabel="Campaign funnel from clicks through to signups"
              steps={[
                { key: "clicks", label: "Clicks", value: totals.clicks },
                {
                  key: "visitors",
                  label: "Visitors",
                  value: totals.visitors,
                  note: "First hit from a browser with no cookie for that link. The same poster walked past twice a day is one visitor, two clicks.",
                },
                { key: "rsvps", label: "RSVPs", value: totals.rsvps },
                { key: "signups", label: "Signups", value: totals.signups },
              ]}
            />
          </Panel>

          <Panel
            title="Which channel is working"
            hint="Ranked by RSVPs, not clicks — a link with one conversion beat a link with forty idle clicks."
          >
            {ranking.length > 0 ? (
              <BarList
                data={ranking}
                ariaLabel="Campaign links ranked by RSVPs"
                tone="stepped"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No campaign traffic yet. Numbers appear here once someone
                follows a link.
              </p>
            )}
          </Panel>
        </div>
      ) : null}

      <Panel
        title="Activity"
        hint={`Clicks per day, last ${days} days`}
        action={
          <div className="flex shrink-0 items-center gap-1">
            {dayRanges.map((d) => (
              <Link
                key={d}
                href={`/admin/links?days=${d}`}
                scroll={false}
                aria-current={d === days ? "true" : undefined}
                className={
                  "rounded-lg px-2 py-1 text-xs transition-colors " +
                  (d === days
                    ? "bg-primary/15 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
                }
              >
                {d}d
              </Link>
            ))}
          </div>
        }
      >
        <TimeSeriesChart
          data={series}
          ariaLabel={`Campaign clicks per day over the last ${days} days`}
          unit="clicks"
        />
      </Panel>

      <Panel
        title="All links"
        hint={
          filtered.length === 0
            ? "Nothing here yet."
            : `${filtered.length} link${filtered.length === 1 ? "" : "s"}`
        }
        action={
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {eventsWithLinks.length > 1 ? (
              <select
                aria-label="Filter by event"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="rounded-lg border border-border/70 bg-card px-2 py-1 text-xs text-foreground"
              >
                <option value="all">All events</option>
                {eventsWithLinks.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border"
              />
              Show archived
            </label>
          </div>
        }
      >
        {byEvent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No campaign links match. Make one above — every event can have as
            many as it has channels.
          </p>
        ) : (
          <div className="space-y-6">
            {byEvent.map((group) => (
              <section key={group[0].event_id} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-1.5">
                  <Link
                    href={`/admin/events/${group[0].event_id}?tab=links`}
                    className="min-w-0 truncate text-sm font-medium text-foreground hover:text-primary"
                  >
                    {group[0].event_title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dateFormat.format(new Date(group[0].event_starts_at))}
                    {group[0].event_status !== "published"
                      ? ` · ${group[0].event_status}`
                      : ""}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {group.map((link) => (
                    <CampaignRow key={link.id} link={link} origin={origin} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function CampaignRow({
  link,
  origin,
}: {
  link: ReferralCampaignRow;
  origin: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const url = `${origin}/r/${link.slug}`;
  const archived = !!link.archived_at;

  function copy() {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }

  function toggleArchive() {
    startTransition(async () => {
      await setReferralLinkArchived({
        linkId: link.id,
        eventId: link.event_id,
        archived: !archived,
      });
      router.refresh();
    });
  }

  return (
    <li
      className={
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border/60 px-3 py-2 " +
        (archived ? "bg-muted/10 opacity-60" : "bg-card")
      }
    >
      <div className="min-w-40 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {link.label}
          {archived ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              archived
            </span>
          ) : null}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          /r/{link.slug}
        </p>
      </div>

      <dl className="flex shrink-0 items-center gap-4 text-xs tabular-nums">
        <Stat label="visitors" value={link.visitors} />
        <Stat label="RSVPs" value={link.rsvps} emphasis />
        <Stat label="signups" value={link.signups} />
        <div className="hidden text-muted-foreground sm:block">
          <dt className="sr-only">Last hit</dt>
          <dd>{relative(link.last_hit_at)}</dd>
        </div>
      </dl>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={copy}
          title={`Copy ${url}`}
          className="gap-1.5 px-2"
        >
          {copied ? (
            <Check size={14} strokeWidth={1.75} aria-hidden />
          ) : (
            <Copy size={14} strokeWidth={1.75} aria-hidden />
          )}
          <span className="sr-only">Copy link</span>
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open the link"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Open {url}</span>
        </a>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={toggleArchive}
          disabled={pending}
          title={archived ? "Restore this link" : "Archive this link"}
          className="px-2"
        >
          {archived ? (
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
          ) : (
            <Archive size={14} strokeWidth={1.75} aria-hidden />
          )}
          <span className="sr-only">
            {archived ? "Restore" : "Archive"} {link.label}
          </span>
        </Button>
      </div>
    </li>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="text-right">
      <dt className="sr-only">{label}</dt>
      <dd
        className={
          emphasis ? "font-semibold text-foreground" : "text-foreground/80"
        }
      >
        {value.toLocaleString()}
      </dd>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function CreateCampaignForm({
  events,
  origin,
}: {
  events: ReferralEventOption[];
  origin: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [eventId, setEventId] = useState("");
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    if (!eventId) {
      setError("Pick the event this campaign points at.");
      return;
    }
    startTransition(async () => {
      const r = await createReferralLink({ eventId, slug: slug.trim(), label });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setLabel("");
      setSlug("");
      setCreated(`${origin}/r/${r.data.slug}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-5"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <label
            htmlFor="campaign-event"
            className="text-xs font-medium text-muted-foreground"
          >
            Event
          </label>
          <select
            id="campaign-event"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            disabled={pending}
            className="h-9 w-full rounded-xl border border-border/70 bg-card px-3 text-sm text-foreground"
          >
            <option value="">Choose an event…</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
                {ev.status !== "published" ? ` (${ev.status})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-56 flex-1 space-y-1.5">
          <label
            htmlFor="campaign-label"
            className="text-xs font-medium text-muted-foreground"
          >
            What is it for
          </label>
          <Input
            id="campaign-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Library flyer"
            disabled={pending}
            className="rounded-xl"
          />
        </div>

        <div className="min-w-56 flex-1 space-y-1.5">
          <label
            htmlFor="campaign-slug"
            className="text-xs font-medium text-muted-foreground"
          >
            Custom link{" "}
            <span className="font-normal">— leave blank for a random one</span>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-sm text-muted-foreground">/r/</span>
            <Input
              id="campaign-slug"
              value={slug}
              // Typed straight into a URL, so normalise as they type rather
              // than rejecting on submit: an officer shouldn't get an error
              // for the capital letter they started the word with.
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
              }
              placeholder="library-flyer"
              disabled={pending}
              className="rounded-xl"
            />
          </div>
        </div>

        <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
          {slug.trim() ? (
            <Link2 size={14} strokeWidth={1.75} aria-hidden />
          ) : (
            <Sparkles size={14} strokeWidth={1.75} aria-hidden />
          )}
          {pending ? "Creating…" : "Create link"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Short links are easier to type off a poster and easier to trust than a
        long one. Random links avoid the letters people misread — no i, l, o,
        0 or 1.
      </p>

      {created ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground"
        >
          <span className="font-mono text-xs">{created}</span>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(created)}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            Copy
          </button>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
    </form>
  );
}
