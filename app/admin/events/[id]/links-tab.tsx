"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  ReferralDashboard,
  ReferralDay,
  ReferralLinkRow,
} from "@/lib/actions/referrals-schemas";
import { BarList, Funnel, Panel } from "@/app/admin/_components/charts";
import { TimeSeriesChart } from "@/app/admin/_components/time-series-chart";

// Campaign links for one event.
//
// The numbers here are aggregate by construction — referral_link_hits holds no
// identifier for anyone (see migration 20260824150000). That is worth knowing
// while reading this file: there is no drill-down to build, because there is
// nothing to drill into.
//
// Four numbers per link, in funnel order. Visitors leads rather than clicks
// because clicks includes the same person walking past the same poster twice
// a day, and a campaign that looks like 400 hits from 30 people is a different
// decision than one with 400 hits from 400.

export function LinksTab({
  eventId,
  data,
  origin,
  error,
}: {
  eventId: string;
  data: ReferralDashboard;
  origin: string;
  error: string | null;
}) {
  const { links, totals, daily, days } = data;
  const active = links.filter((l) => !l.archived_at);
  const archived = links.filter((l) => l.archived_at);
  const anyActivity = totals.clicks > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          Campaign links
        </h2>
        <p className="text-sm text-muted-foreground">
          One link per place you push this event — a flyer, a Discord post, a
          class announcement. Each redirects to the event page and counts what
          happened next, so you can tell which push actually worked.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load campaign links: {error}
        </div>
      ) : null}

      {anyActivity ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Campaign funnel"
            hint={`${totals.visitors.toLocaleString()} people reached this event through a link`}
          >
            <Funnel
              ariaLabel={`Campaign funnel: ${totals.visitors} visitors, ${totals.rsvps} RSVPs, ${totals.signups} signups`}
              steps={[
                {
                  key: "visitors",
                  label: "Visitors",
                  value: totals.visitors,
                  note: `${totals.clicks.toLocaleString()} clicks in total — the gap is people opening the same link twice.`,
                },
                { key: "rsvps", label: "RSVP'd", value: totals.rsvps },
                {
                  key: "signups",
                  label: "Made an account",
                  value: totals.signups,
                  note: "Counted only for people whose account did not exist before they followed a link.",
                },
              ]}
            />
          </Panel>

          <Panel title="Activity" hint={`Last ${days} days`}>
            <TimeSeriesChart
              unit="visitors"
              height="h-32"
              data={dailyColumns(daily)}
              ariaLabel={dailySummary(daily)}
            />
          </Panel>
        </div>
      ) : null}

      {anyActivity && active.length > 1 ? (
        <Panel title="Which channel worked" hint="Ranked by RSVPs">
          <BarList
            tone="stepped"
            ariaLabel="Links ranked by RSVPs"
            data={[...links]
              .sort((a, b) => b.rsvps - a.rsvps)
              .map((l) => ({
                key: l.id,
                label: l.label,
                value: l.rsvps,
                hint:
                  l.visitors > 0
                    ? `${Math.round((l.rsvps / l.visitors) * 100)}% of ${l.visitors.toLocaleString()}`
                    : "no visitors yet",
              }))}
          />
        </Panel>
      ) : null}

      <CreateForm eventId={eventId} origin={origin} />

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No links yet. Make one above and put it on something.
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((l) => (
            <LinkRow key={l.id} link={l} eventId={eventId} origin={origin} />
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Archived ({archived.length})
          </h3>
          <p className="text-xs text-muted-foreground">
            These stop redirecting — anyone following one lands on the events
            list instead. Their numbers are kept.
          </p>
          <ul className="space-y-2">
            {archived.map((l) => (
              <LinkRow key={l.id} link={l} eventId={eventId} origin={origin} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CreateForm({ eventId, origin }: { eventId: string; origin: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await createReferralLink({ eventId, slug: slug.trim(), label });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setLabel("");
      setSlug("");
      setNotice(`Created ${origin}/r/${r.data.slug}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <label
            htmlFor="referral-label"
            className="text-xs font-medium text-muted-foreground"
          >
            What is it for
          </label>
          <Input
            id="referral-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Library flyer"
            disabled={pending}
            className="rounded-xl"
          />
        </div>

        <div className="min-w-56 flex-1 space-y-1.5">
          <label
            htmlFor="referral-slug"
            className="text-xs font-medium text-muted-foreground"
          >
            Custom link{" "}
            <span className="font-normal">— leave blank for a random one</span>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-sm text-muted-foreground">/r/</span>
            <Input
              id="referral-slug"
              value={slug}
              // Typed straight into a URL, so normalise as they type rather
              // than rejecting on submit: an officer shouldn't get an error
              // for the capital letter they started the word with.
              onChange={(e) =>
                setSlug(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")
                )
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

      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground"
        >
          {notice}
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

function LinkRow({
  link,
  eventId,
  origin,
}: {
  link: ReferralLinkRow;
  eventId: string;
  origin: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const url = `${origin}/r/${link.slug}`;
  const isArchived = !!link.archived_at;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and blocked outright in some embedded
      // browsers. The URL is on screen and selectable, so this is a silent
      // no-op rather than an error the officer can do anything about.
    }
  }

  function onToggleArchived() {
    startTransition(async () => {
      await setReferralLinkArchived({
        linkId: link.id,
        eventId,
        archived: !isArchived,
      });
      router.refresh();
    });
  }

  return (
    <li
      className={
        "rounded-xl border border-border/70 px-4 py-3 " +
        (isArchived ? "opacity-60" : "")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] text-foreground">{link.label}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <code className="truncate text-xs text-muted-foreground">
              {origin.replace(/^https?:\/\//, "")}/r/{link.slug}
            </code>
            <button
              type="button"
              onClick={onCopy}
              title="Copy link"
              aria-label={`Copy link for ${link.label}`}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? (
                <Check size={13} strokeWidth={1.75} aria-hidden />
              ) : (
                <Copy size={13} strokeWidth={1.75} aria-hidden />
              )}
            </button>
            {!isArchived ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title="Open link"
                aria-label={`Open link for ${link.label}`}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden />
              </a>
            ) : null}
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={onToggleArchived}
          className="gap-1.5 text-muted-foreground"
        >
          {isArchived ? (
            <>
              <RotateCcw size={13} strokeWidth={1.75} aria-hidden />
              Restore
            </>
          ) : (
            <>
              <Archive size={13} strokeWidth={1.75} aria-hidden />
              Archive
            </>
          )}
        </Button>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        <Stat label="Visitors" value={link.visitors} />
        <Stat label="Clicks" value={link.clicks} />
        <Stat label="RSVPs" value={link.rsvps} share={rate(link.rsvps, link.visitors)} />
        <Stat label="Signups" value={link.signups} share={rate(link.signups, link.visitors)} />
      </dl>
    </li>
  );
}

function rate(part: number, whole: number): string | null {
  if (whole <= 0 || part <= 0) return null;
  return `${Math.round((part / whole) * 100)}%`;
}

function Stat({
  label,
  value,
  share,
}: {
  label: string;
  value: number;
  share?: string | null;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-foreground">
        {value.toLocaleString()}
        {share ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {share}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

const dayLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function dailyColumns(rows: ReferralDay[]) {
  return rows.map((r) => {
    const label = dayLabel.format(new Date(`${r.day}T00:00:00Z`));
    const parts = [`${r.clicks} click${r.clicks === 1 ? "" : "s"}`];
    if (r.rsvps > 0) parts.push(`${r.rsvps} RSVP${r.rsvps === 1 ? "" : "s"}`);
    if (r.signups > 0) {
      parts.push(`${r.signups} signup${r.signups === 1 ? "" : "s"}`);
    }
    return {
      key: r.day,
      label,
      title: label,
      // Visitors is the headline rather than clicks: it is the number that
      // maps to people, and the tooltip carries the rest.
      value: r.visitors,
      note: parts.join(" · "),
    };
  });
}

function dailySummary(rows: ReferralDay[]): string {
  if (rows.length === 0) return "Campaign activity: no data";
  const visitors = rows.reduce((sum, r) => sum + r.visitors, 0);
  const rsvps = rows.reduce((sum, r) => sum + r.rsvps, 0);
  const peak = rows.reduce((best, r) => (r.visitors > best.visitors ? r : best), rows[0]);
  return `Campaign activity over ${rows.length} days: ${visitors} visitors and ${rsvps} RSVPs, peaking at ${peak.visitors} visitors on ${dayLabel.format(new Date(`${peak.day}T00:00:00Z`))}`;
}
