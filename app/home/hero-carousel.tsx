"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";

import { CountdownTimer } from "./countdown-timer";

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
        {/* Lighter scrim: just enough for the overlay text to read (helped
            along by the drop-shadow on the text itself), without flattening
            the art into a black box. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute left-4 top-4 rounded-xl border border-white/20 bg-black px-2.5 py-1.5 backdrop-blur-md sm:left-6 sm:top-6">
          <CountdownTimer target={event.starts_at} />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 pr-24 sm:p-6 sm:pr-28">
          <p className="text-2xl font-black tracking-tight text-white drop-shadow-lg sm:text-4xl">
            {event.title.toLowerCase()}
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-white/80">
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

const REAL_SLIDES = 2; // event, video

// Two-slide carousel in the same card: the featured event art first, the
// recap video right after it. Motion only ever goes forward/right — with
// only 2 real slides, looping back to the event slide via a plain index
// wrap would animate backwards, so the track is actually 3-wide (event,
// video, event-again) and silently snaps from the duplicate back to
// position 0 once the forward transition finishes.
export function HeroCarousel({
  event,
  hosts,
  videoId,
}: {
  event: HeroEvent;
  hosts: string | null;
  videoId: string;
}) {
  const [trackPos, setTrackPos] = useState(0); // 0, 1, or 2 (2 = duplicate of 0)
  const [animated, setAnimated] = useState(true);
  const activeDot = trackPos % REAL_SLIDES;

  // No-ops while sitting on the duplicate slide, waiting for the snap-back
  // below — otherwise a click landing in that ~700ms window would push past
  // the end of the track.
  const advance = () => {
    setAnimated(true);
    setTrackPos((p) => (p >= REAL_SLIDES ? p : p + 1));
  };

  // Auto-advance every 15s. Restarts on every step (manual or auto) so a
  // manual click gets a fresh window instead of an immediate second jump.
  useEffect(() => {
    const id = setInterval(advance, 15_000);
    return () => clearInterval(id);
  }, [trackPos]);

  // Landed on the duplicate slide: once the transition finishes, snap back
  // to the real position 0 with the transition disabled for that one frame
  // so the reset is invisible (the duplicate is pixel-identical to slide 0).
  useEffect(() => {
    if (trackPos !== REAL_SLIDES) return;
    const id = setTimeout(() => {
      setAnimated(false);
      setTrackPos(0);
    }, 700);
    return () => clearTimeout(id);
  }, [trackPos]);

  // Re-enable the transition on the next frame after an instant snap.
  useEffect(() => {
    if (animated) return;
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [animated]);

  return (
    <div className="relative h-[420px] overflow-hidden rounded-2xl glass sm:h-[560px]">
      <div
        className="flex h-full"
        style={{
          width: `${(REAL_SLIDES + 1) * 100}%`,
          transform: `translateX(-${(trackPos * 100) / (REAL_SLIDES + 1)}%)`,
          transition: animated ? "transform 700ms cubic-bezier(0.16,1,0.3,1)" : "none",
        }}
      >
        <div className="h-full w-full shrink-0" style={{ width: `${100 / (REAL_SLIDES + 1)}%` }}>
          <EventSlide event={event} hosts={hosts} />
        </div>
        <div className="h-full w-full shrink-0" style={{ width: `${100 / (REAL_SLIDES + 1)}%` }}>
          <VideoSlide videoId={videoId} />
        </div>
        <div className="h-full w-full shrink-0" style={{ width: `${100 / (REAL_SLIDES + 1)}%` }}>
          <EventSlide event={event} hosts={hosts} />
        </div>
      </div>

      <button
        type="button"
        aria-label="next slide"
        onClick={advance}
        className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm hover:bg-black/70"
      >
        <ChevronRight size={18} />
      </button>

      <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-2">
        {Array.from({ length: REAL_SLIDES }).map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`go to slide ${i + 1}`}
            onClick={() => {
              if (i !== activeDot) advance();
            }}
            className={`h-1.5 w-6 rounded-full transition-colors ${
              i === activeDot ? "bg-white" : "bg-white/30"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
