import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Globe, Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { resolveCoverUrl } from "@/lib/events/cover-url";

import { joinHosts, type HostRef } from "../events/_components/event-card";
import { EVENT_TIME_ZONE } from "../events/_components/event-date";
import { CountdownTimer } from "./countdown-timer";
import { HeroCarousel } from "./hero-carousel";

const HACKLANTA_RECAP_VIDEO_ID = "OltQSnt5CHc";

// Visitor-facing hub: works signed-in or signed-out (layout handles both).
// The grid below the header is initiatives, not internal navigation — Events
// and Members already have their own nav items, so they don't get a card
// here too.
export default async function HomePage() {
  const { pinnedEvent, nextEvent } = await loadHomeEvents();

  return (
    <div className="space-y-8 py-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Home</h1>
      </header>

      {pinnedEvent ? (
        <section className={`space-y-3 ${STAGGER} delay-0`}>
          <div className="flex justify-end">
            <div className="inline-flex items-center gap-3 px-3 py-2">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-white">
                featured
              </span>
              <span aria-hidden className="h-4 w-px bg-white/30" />
              <CountdownTimer target={pinnedEvent.starts_at} />
            </div>
          </div>
          <HeroCarousel
            event={pinnedEvent}
            hosts={joinHosts(pinnedEvent.hosts)}
            videoId={HACKLANTA_RECAP_VIDEO_ID}
          />
        </section>
      ) : null}

      <section className="space-y-6">
        <h2
          className={`text-3xl font-bold tracking-tight text-foreground sm:text-5xl ${STAGGER} delay-[90ms]`}
        >
          more from progsu
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {nextEvent ? (
            <div className={`${STAGGER} delay-[170ms]`}>
              <UpcomingEventCard event={nextEvent} />
            </div>
          ) : null}
          <div className={`${STAGGER} delay-[230ms]`}>
            <WikiCard />
          </div>
          <div className={`${STAGGER} delay-[290ms]`}>
            <ProgsuSiteCard />
          </div>
        </div>
      </section>
    </div>
  );
}

// Single page-load motion moment: everything above fades/slides in once, in
// reading order, via the `delay-*` on each usage — no client component
// needed since these are just CSS animation utilities on server-rendered
// markup. `fill-mode-both` holds the pre-animation state through the delay
// instead of flashing full-opacity content first.
const STAGGER =
  "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] fill-mode-both motion-reduce:animate-none";

type UpcomingEventRow = {
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  cover_image_path: string | null;
  hosts: HostRef[] | null;
  external_url: string | null;
  going_count: number;
  pinned: boolean;
};

type HomeEvent = UpcomingEventRow & { coverUrl: string | null };

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
});
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  day: "numeric",
});

// Anon-safe: same public_upcoming_events() RPC the signed-out /events list
// uses. Pinned event (Hacklanta right now) leads as the hero; the first
// non-pinned upcoming event fills the "more from progsu" slot — so this
// stays correct without hardcoding a slug as events come and go.
async function loadHomeEvents() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_upcoming_events", {
    p_limit: 50,
  });
  if (error || !data) return { pinnedEvent: null, nextEvent: null };

  const rows = data as UpcomingEventRow[];
  const pinnedRow = rows.find((r) => r.pinned) ?? null;
  const nextRow = rows.find((r) => !r.pinned) ?? null;
  const withCover = async (row: UpcomingEventRow | null) =>
    row
      ? { ...row, coverUrl: await resolveCoverUrl(supabase, row.cover_image_path) }
      : null;
  const [pinnedEvent, nextEvent] = await Promise.all([
    withCover(pinnedRow),
    withCover(nextRow),
  ]);
  return { pinnedEvent, nextEvent };
}

// Shared card shell so all three initiative tiles share the same glass/hover
// treatment, whether they link out or link internally.
function InitiativeCard({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const classes = `group flex h-full flex-col overflow-hidden rounded-2xl glass glass-interactive transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

// Tinted-glass chip instead of a flat gray pill, so it reads as an accent
// on top of `.glass`/image surfaces rather than a disconnected gray sticker.
// `leading-none` + `py-1` keeps the icon and text on the same optical
// baseline; `backdrop-blur-sm` keeps it legible sitting on a photo, not
// just on glass.
function CardBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold leading-none tracking-wide text-primary backdrop-blur-sm dark:border-primary/25 dark:bg-primary/15">
      {children}
    </span>
  );
}

// `light`: white-on-image variant for the overlay tiles below, instead of
// the default foreground-on-panel styling.
function CardVisitLink({ label, light }: { label: string; light?: boolean }) {
  return (
    <span
      className={`mt-auto inline-flex items-center gap-1 text-xs font-medium ${
        light
          ? "text-white/80 group-hover:text-white"
          : "pt-3 text-sm text-foreground group-hover:text-primary"
      }`}
    >
      {label}
      <ArrowUpRight
        size={12}
        strokeWidth={1.75}
        className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
      />
    </span>
  );
}

// Shared shape for the "offer row" tiles below the hero: art fills the
// whole card, badge top-right, name/caption/link overlaid bottom-left on
// the scrim — no separate content panel, so every tile stays the same size
// regardless of how much copy it carries.
function OfferTile({
  href,
  external,
  image,
  badge,
  name,
  caption,
  visitLabel,
}: {
  href: string;
  external?: boolean;
  image: React.ReactNode;
  badge: React.ReactNode;
  name: string;
  caption: string;
  visitLabel: string;
}) {
  return (
    <InitiativeCard href={href} external={external}>
      <div className="relative aspect-[16/9] overflow-hidden">
        {image}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 from-0% via-black/70 via-30% to-transparent to-70%" />
        <div className="absolute right-3 top-3">{badge}</div>
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3">
          <p className="text-base font-bold tracking-tight text-white drop-shadow-lg">
            {name}
          </p>
          <p className="line-clamp-2 text-xs text-white/70">{caption}</p>
          <CardVisitLink label={visitLabel} light />
        </div>
      </div>
    </InitiativeCard>
  );
}

// Live counterpart to OfferTile: same sizing and overlay layout, but for a
// real upcoming event (cover art is a signed Supabase URL, so plain `img`
// like the hero, not next/image with a static asset path).
function UpcomingEventCard({ event }: { event: HomeEvent }) {
  const start = new Date(event.starts_at);
  const href = event.external_url ?? `/events/${event.slug}`;
  return (
    <OfferTile
      href={href}
      external={!!event.external_url}
      image={
        event.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-primary/20">
            <CalendarDays
              size={32}
              strokeWidth={1.5}
              className="text-muted-foreground/60"
              aria-hidden
            />
          </div>
        )
      }
      badge={
        <div className="inline-flex w-fit shrink-0 items-center overflow-hidden rounded-full border border-white/20 bg-black/50 backdrop-blur-sm">
          <span className="inline-flex items-center gap-1.5 py-1 pl-2.5 pr-2 text-[10px] font-semibold leading-none tracking-wide text-primary">
            <Users size={12} strokeWidth={2} />
            {event.going_count} going
          </span>
          <span aria-hidden className="h-3 w-px bg-white/25" />
          <span className="py-1 pl-2 pr-2.5 text-[11px] font-bold leading-none tracking-tight text-white">
            {monthFormatter.format(start).toLowerCase()} {dayFormatter.format(start)}
          </span>
        </div>
      }
      name={event.title.toLowerCase()}
      caption={
        event.slug === "fall-kickoff-carnival"
          ? "free macbook + $1,000 in prizes, games, food, and fun"
          : event.location_text?.toLowerCase() ?? "location tbd"
      }
      visitLabel="view event"
    />
  );
}

// Photo-led like Hacklanta's hero, but a shorter image band and a
// pull-quote line underneath so it still reads as one of two "quieter"
// side tiles next to the live event card.
function WikiCard() {
  return (
    <OfferTile
      href="https://wiki.progsu.com/guides/zero-to-hero"
      external
      image={
        <Image
          src="/wiki-preview.png"
          alt="Progsu wiki: an open wiki for breaking into tech"
          fill
          className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      }
      badge={<CardBadge>just dropped ❕</CardBadge>}
      name="wiki: zero to hero"
      caption="the real guide on how to break into tech, starting from nothing."
      visitLabel="visit wiki.progsu.com"
    />
  );
}

// Photo-led, compact — same tile shape as Wiki's so the two side tiles
// still read as a consistent pair next to the live event card.
function ProgsuSiteCard() {
  return (
    <OfferTile
      href="https://progsu.com"
      external
      image={
        <Image
          src="/progsu-site-preview.jpg"
          alt="progsu.com: builders and dreamers of ATL"
          fill
          className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      }
      badge={
        <CardBadge>
          <Globe size={11} strokeWidth={2} />
          official site
        </CardBadge>
      }
      name="progsu official"
      caption="mission, team, and the movements we're building beyond any one event."
      visitLabel="visit progsu.com"
    />
  );
}
