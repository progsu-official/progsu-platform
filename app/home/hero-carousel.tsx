"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";

type HeroEvent = {
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  coverUrl: string | null;
  external_url: string | null;
};

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "short" });
const dayFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric" });

function EventSlide({ event, hosts }: { event: HeroEvent; hosts: string | null }) {
  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const startDay = dayFormatter.format(start);
  const endDay = dayFormatter.format(end);
  const heroHref = event.external_url ?? `/events/${event.slug}`;

  return (
    <a
      href={heroHref}
      target={event.external_url ? "_blank" : undefined}
      rel={event.external_url ? "noopener noreferrer" : undefined}
      className="group block h-full w-full"
    >
      <div className="relative h-full w-full bg-gradient-to-br from-muted to-primary/20">
        {event.coverUrl ? (
          // Plain img, not next/image: Supabase signed cover URLs are
          // per-request-unique and the storage host isn't configured under
          // images.remotePatterns, same reasoning as EventCard's cover tile.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <CalendarDays
              size={40}
              strokeWidth={1.5}
              className="text-muted-foreground/60"
              aria-hidden
            />
          </div>
        )}
        {/* Scrim: solid enough over the bottom half to fully bury whatever's
            underneath (event art often has its own baked-in title/date
            text), fading out only in the top third so the art still reads. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 from-15% via-black/70 via-45% to-transparent to-85%" />
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
          <p className="text-2xl font-black tracking-tight text-white drop-shadow-lg sm:text-4xl">
            {event.title.toLowerCase()}
          </p>
          <p className="mt-1 text-sm text-white/80">
            progsu&apos;s biggest event of the year, rsvp now, slots are limited.
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/70">
            {hosts ? <span>by {hosts}</span> : null}
            {event.location_text ? (
              <span className="flex items-center gap-1.5">
                <MapPin size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                {event.location_text.toLowerCase()}
              </span>
            ) : null}
          </p>
        </div>
        {/* Meaningful stand-in for a price badge: an actual date, not a
            fake currency value — there's nothing being sold here. */}
        <div className="absolute bottom-4 right-4 flex flex-col items-center rounded-xl border border-white/20 bg-black/50 px-3 py-1.5 leading-none backdrop-blur-md sm:bottom-6 sm:right-6">
          <span className="text-xs font-black uppercase tracking-[0.2em] text-white">
            {monthFormatter.format(start).toLowerCase()}
          </span>
          <span className="whitespace-nowrap text-xl font-black tracking-tight text-white sm:text-2xl">
            {startDay === endDay ? startDay : `${startDay}–${endDay}`}
          </span>
        </div>
      </div>
    </a>
  );
}

function VideoSlide({ videoId }: { videoId: string }) {
  return (
    <iframe
      src={`https://www.youtube.com/embed/${videoId}`}
      title="hacklanta video"
      className="h-full w-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}

const SLIDE_COUNT = 2;

// Two-slide carousel in the same card: the featured event art first, the
// recap video right after it. Slides sit side by side and translate on a
// smooth transition when the dots/arrows switch between them; the event
// slide still opens the event's site in a new tab like a normal link.
export function HeroCarousel({
  event,
  hosts,
  videoId,
}: {
  event: HeroEvent;
  hosts: string | null;
  videoId: string;
}) {
  const [slide, setSlide] = useState(0);

  return (
    <div className="relative min-h-[420px] overflow-hidden rounded-2xl glass sm:min-h-[560px]">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="absolute inset-0 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ transform: `translateX(${(i - slide) * 100}%)` }}
        >
          {i === 0 ? <EventSlide event={event} hosts={hosts} /> : <VideoSlide videoId={videoId} />}
        </div>
      ))}

      <button
        type="button"
        aria-label="previous slide"
        onClick={() => setSlide((s) => (s + SLIDE_COUNT - 1) % SLIDE_COUNT)}
        className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm hover:bg-black/70"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        aria-label="next slide"
        onClick={() => setSlide((s) => (s + 1) % SLIDE_COUNT)}
        className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm hover:bg-black/70"
      >
        <ChevronRight size={18} />
      </button>

      <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-2">
        {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`go to slide ${i + 1}`}
            onClick={() => setSlide(i)}
            className={`h-1.5 w-6 rounded-full transition-colors ${
              i === slide ? "bg-white" : "bg-white/30"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
