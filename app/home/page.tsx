import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Globe, Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { resolveCoverUrl } from "@/lib/events/cover-url";

import { EventCard, joinHosts, type HostRef } from "../events/_components/event-card";

// Visitor-facing hub: works signed-in or signed-out (layout handles both).
// "Up next" is a live event preview off the same RPC the public events list
// uses. The grid below it is initiatives, not internal navigation — Events
// and Members already have their own nav items, so they don't get a card
// here too.
export default async function HomePage() {
  const nextEvent = await loadNextEvent();

  return (
    <div className="space-y-8 py-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Home</h1>
        <p className="mt-1 text-muted-foreground">
          What Progsu is doing right now.
        </p>
      </header>

      {nextEvent ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Up next
          </h2>
          <ul>
            <EventCard
              href={`/events/${nextEvent.slug}`}
              title={nextEvent.title}
              hosts={joinHosts(nextEvent.hosts)}
              startsAt={nextEvent.starts_at}
              endsAt={nextEvent.ends_at}
              location={nextEvent.location_text}
              coverUrl={nextEvent.coverUrl}
              showDate
            />
          </ul>
        </section>
      ) : null}

      <section className="space-y-6">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
          More from Progsu
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <HacklantaCard />
          </div>
          <div className="flex flex-col gap-4">
            <WikiCard />
            <ProgsuSiteCard />
          </div>
        </div>
      </section>
    </div>
  );
}

// Anon-safe: same public_upcoming_events() RPC the signed-out /events list
// uses (see app/events/page.tsx), so this stays correct without hardcoding
// a slug — whatever's soonest shows up here.
async function loadNextEvent() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_upcoming_events", {
    p_limit: 1,
  });
  if (error || !data || data.length === 0) return null;

  const row = data[0] as {
    slug: string;
    title: string;
    starts_at: string;
    ends_at: string;
    location_text: string | null;
    cover_image_path: string | null;
    hosts: HostRef[] | null;
  };
  const coverUrl = await resolveCoverUrl(supabase, row.cover_image_path);
  return { ...row, coverUrl };
}

// Shared card shell so all three initiative tiles share the same glass/hover
// treatment regardless of size, or whether they link out, link internally,
// or go nowhere yet.
function InitiativeCard({
  href,
  external,
  comingSoon,
  children,
}: {
  href?: string;
  external?: boolean;
  comingSoon?: boolean;
  children: React.ReactNode;
}) {
  const classes = `group flex h-full flex-col overflow-hidden rounded-2xl ${
    comingSoon ? "border border-dashed border-border/80" : "glass glass-interactive"
  } transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
    href ? "hover:-translate-y-1" : ""
  } motion-reduce:transition-none motion-reduce:hover:translate-y-0`;

  if (!href) return <div className={classes}>{children}</div>;
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

function CardBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/60 bg-muted px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
          alt="Hacklanta '26 — Different Rhythm, Higher Stakes, Oct 9-11"
          fill
          className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-500 via-pink-500 to-amber-400 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg shadow-black/30">
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-white/80 motion-safe:animate-ping motion-reduce:hidden" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          Coming up
        </span>
        {/* Spine label — decorative, echoes the badge below along the image edge */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-9 items-center justify-center bg-gradient-to-l from-black/70 to-transparent sm:flex"
        >
          <span className="[writing-mode:vertical-rl] text-[10px] font-bold uppercase tracking-[0.35em] text-white/85">
            Flagship Hackathon
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-2 p-5">
        <div className="flex items-center gap-2">
          <CardBadge>
            <Sparkles size={11} strokeWidth={2} />
            Flagship hackathon
          </CardBadge>
          <span className="text-xs font-bold tracking-tight text-foreground">Oct 9–11</span>
        </div>
        <p className="text-xl font-bold tracking-tight text-foreground">Hacklanta II</p>
        <p className="text-sm text-muted-foreground">
          Progsu&apos;s biggest event of the year — a weekend hackathon where
          you build, ship, and pitch in front of real sponsors. Team
          formation and sponsor challenges get announced closer to the date,
          so check back.
        </p>
        <CardVisitLink label="Visit hacklanta.dev" />
      </div>
    </InitiativeCard>
  );
}

function WikiCard() {
  return (
    <InitiativeCard comingSoon>
      <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-gradient-to-br from-muted/70 to-muted/10">
        <BookOpen size={28} strokeWidth={1.5} className="text-muted-foreground/40" aria-hidden />
        <span className="absolute right-3 top-3">
          <CardBadge>Coming soon</CardBadge>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <p className="text-base font-medium text-foreground">Wiki: Zero to Hero</p>
        <p className="text-sm text-muted-foreground">
          Every facet of the tech journey in one place — picking a stack,
          git and dev environments, internships and interview prep, resumes
          and portfolios, open source, and shipping your first real project.
          Being written now.
        </p>
      </div>
    </InitiativeCard>
  );
}

function ProgsuSiteCard() {
  return (
    <InitiativeCard href="https://progsu.com" external>
      <div className="relative aspect-[16/9] overflow-hidden">
        <Image
          src="/progsu-site-preview.jpg"
          alt="progsu.com — builders and dreamers of ATL"
          fill
          className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <CardBadge>
          <Globe size={11} strokeWidth={2} />
          Official site
        </CardBadge>
        <p className="text-base font-medium text-foreground">Progsu</p>
        <p className="text-sm text-muted-foreground">
          This platform runs RSVPs and member profiles. progsu.com is our
          public home — mission, team, and the movements we&apos;re building
          beyond any one event.
        </p>
        <CardVisitLink label="Visit progsu.com" />
      </div>
    </InitiativeCard>
  );
}
