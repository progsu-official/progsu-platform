import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Globe, Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/server";

import { CountdownTimer } from "./countdown-timer";

// Visitor-facing hub: works signed-in or signed-out (layout handles both).
// The grid below the header is initiatives, not internal navigation — Events
// and Members already have their own nav items, so they don't get a card
// here too.
export default async function HomePage() {
  const pinnedEvent = await loadPinnedEvent();

  return (
    <div className="space-y-8 py-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Home</h1>
        <p className="mt-1 text-muted-foreground">
          What Progsu is doing right now
        </p>
      </header>

      {pinnedEvent ? (
        <CountdownTimer startsAt={pinnedEvent.starts_at} label={pinnedEvent.title} />
      ) : null}

      <section className="space-y-6">
        <h2
          className={`text-3xl font-bold tracking-tight text-foreground sm:text-5xl ${STAGGER} delay-0`}
        >
          More from Progsu
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={`sm:col-span-2 ${STAGGER} delay-[90ms]`}>
            <HacklantaCard />
          </div>
          <div className="flex flex-col gap-4">
            <div className={`${STAGGER} delay-[170ms]`}>
              <WikiCard />
            </div>
            <div className={`${STAGGER} delay-[230ms]`}>
              <ProgsuSiteCard />
            </div>
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

// Anon-safe: same public_upcoming_events() RPC the signed-out /events list
// uses, filtered to whichever event is pinned (Hacklanta right now).
async function loadPinnedEvent() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_upcoming_events", {
    p_limit: 50,
  });
  if (error || !data) return null;
  const pinned = (
    data as Array<{ title: string; starts_at: string; pinned: boolean }>
  ).find((r) => r.pinned);
  return pinned ?? null;
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
// baseline; `backdrop-blur-sm` keeps it legible sitting on the Wiki card's
// photo, not just on glass.
function CardBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase leading-none tracking-wide text-primary backdrop-blur-sm dark:border-primary/25 dark:bg-primary/15">
      {children}
    </span>
  );
}

function CardVisitLink({ label }: { label: string }) {
  return (
    <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-medium text-foreground group-hover:text-primary">
      {label}
      <ArrowUpRight
        size={14}
        strokeWidth={1.75}
        className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
      />
    </span>
  );
}

function HacklantaCard() {
  return (
    <InitiativeCard href="https://hacklanta.dev" external>
      <div className="relative min-h-[220px] flex-1 overflow-hidden sm:min-h-[320px]">
        <Image
          src="/hacklanta-ii-26.png"
          alt="Hacklanta '26: Different Rhythm, Higher Stakes, Oct 9-11"
          fill
          className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </div>
      <div className="flex flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xl font-bold tracking-tight text-foreground">Hacklanta II</p>
          {/* One segmented pill instead of a badge + a loose date tag side by
              side — the divider gives them a shared edge instead of floating
              independently at slightly different heights. */}
          <div className="inline-flex w-fit shrink-0 items-center overflow-hidden rounded-full border border-primary/20 bg-primary/10 backdrop-blur-sm dark:border-primary/25 dark:bg-primary/15">
            <span className="inline-flex items-center gap-1.5 py-1 pl-2.5 pr-2 text-[10px] font-semibold uppercase leading-none tracking-wide text-primary">
              <Sparkles size={12} strokeWidth={2} />
              Flagship hackathon
            </span>
            <span aria-hidden className="h-3 w-px bg-primary/25 dark:bg-primary/30" />
            <span className="py-1 pl-2 pr-2.5 text-[11px] font-bold leading-none tracking-tight text-foreground">
              Oct 9–11
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Progsu&apos;s biggest event of the year, a weekend hackathon where
          you build, ship, and pitch in front of real sponsors. Team
          formation and sponsor challenges get announced closer to the date,
          so check back.
        </p>
        <CardVisitLink label="Visit hacklanta.dev" />
      </div>
    </InitiativeCard>
  );
}

// Photo-led like Hacklanta, but a shorter image band and a pull-quote line
// underneath so it still reads as the "quieter" of the two side tiles.
function WikiCard() {
  return (
    <InitiativeCard href="https://wiki.progsu.com/guides/zero-to-hero" external>
      <div className="relative aspect-[16/9] overflow-hidden">
        <Image
          src="/wiki-preview.png"
          alt="Progsu wiki: an open wiki for breaking into tech"
          fill
          className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-medium text-foreground">Wiki: Zero to Hero</p>
          <CardBadge>Just dropped ❕</CardBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          The real guide on how to break into tech, starting from nothing:
          your roadmap by year, and how to land your first internship.
        </p>
        <CardVisitLink label="Visit wiki.progsu.com" />
      </div>
    </InitiativeCard>
  );
}

// Photo-led, compact — smaller image band than Wiki's so the two side tiles
// still read as different weights, not identical shapes.
function ProgsuSiteCard() {
  return (
    <InitiativeCard href="https://progsu.com" external>
      <div className="relative aspect-[2/1] overflow-hidden">
        <Image
          src="/progsu-site-preview.jpg"
          alt="progsu.com: builders and dreamers of ATL"
          fill
          className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-medium text-foreground">Progsu</p>
          <CardBadge>
            <Globe size={11} strokeWidth={2} />
            Official site
          </CardBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          Mission, team, and the movements we&apos;re building beyond any
          one event.
        </p>
        <CardVisitLink label="Visit progsu.com" />
      </div>
    </InitiativeCard>
  );
}
