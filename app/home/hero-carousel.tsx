"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarDays, ChevronRight, MapPin } from "lucide-react";

import { CountdownTimer } from "./countdown-timer";

// Minimal shape of the bits of the YouTube IFrame Player API this file
// actually uses — not worth a full @types/youtube dependency for this.
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: { events: { onStateChange: (e: { data: number }) => void } }
      ) => { destroy: () => void };
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

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
      className="group block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
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
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            style={EASE}
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
        {/* Two scrims, not one. Campaign art usually carries its own
            lettering, and a single bottom fade left the title fighting it.
            The vertical fade owns the bottom third outright; the lateral one
            darkens only the column the copy sits in, so the art still reads
            at full strength on the right. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black via-black/75 via-50% to-black/20 sm:via-black/60 sm:via-45% sm:to-black/10"
        />
        <div
          aria-hidden
          className="absolute inset-0 hidden bg-gradient-to-r from-black/70 via-black/20 via-50% to-transparent sm:block"
        />

        <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3 sm:inset-x-8 sm:top-8">
          <div className="rounded-2xl border border-white/15 bg-black/55 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur-md sm:px-4 sm:py-3">
            <CountdownTimer target={event.starts_at} />
          </div>
          {/* Inverse plate: the one light surface on dark art, so the date
              is the second thing the eye lands on after the title. */}
          <div className="flex min-w-16 flex-col items-center rounded-2xl bg-white px-3 py-2 text-black shadow-xl shadow-black/40 sm:min-w-20 sm:px-4 sm:py-3">
            <span className="text-[11px] font-black uppercase leading-none tracking-[0.2em] text-primary sm:text-xs">
              {monthFormatter.format(start).toLowerCase()}
            </span>
            <span className="mt-1 whitespace-nowrap text-2xl font-black leading-none tracking-tight tabular-nums sm:text-4xl">
              {startDay === endDay ? startDay : `${startDay}–${endDay}`}
            </span>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-5 pb-12 sm:p-8 sm:pb-8 sm:pr-40 lg:p-10 lg:pr-48">
          <p className="max-w-3xl text-balance text-5xl font-black leading-[0.92] tracking-[-0.035em] text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.45)] sm:text-6xl lg:text-7xl">
            {event.title.toLowerCase()}
          </p>
          <p className="mt-4 line-clamp-2 max-w-lg text-base font-medium text-white/85 sm:text-lg">
            progsu&apos;s biggest event of the year, rsvp now, slots are limited.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black shadow-lg shadow-black/30 transition-transform duration-300 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0" style={EASE}>
              view event
              <ArrowUpRight
                size={16}
                strokeWidth={2}
                aria-hidden
                className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
                style={EASE}
              />
            </span>
            {event.location_text ? (
              <MetaChip>
                <MapPin size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                {event.location_text.toLowerCase()}
              </MetaChip>
            ) : null}
            {hosts ? <MetaChip>by {hosts}</MetaChip> : null}
          </div>
        </div>
      </div>
    </a>
  );
}

const EASE = { transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" };

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-10 max-w-full items-center gap-1.5 truncate rounded-full border border-white/15 bg-white/10 px-4 text-sm font-medium text-white/90 backdrop-blur-md">
      {children}
    </span>
  );
}

type VideoState = "unstarted" | "playing" | "paused" | "ended";

// Wires up the real YouTube IFrame Player API (not just a bare embed) so the
// carousel can tell whether someone is actually watching before it auto-
// advances away from them.
function VideoSlide({
  videoId,
  onStateChange,
}: {
  videoId: string;
  onStateChange: (state: VideoState) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let destroyed = false;
    let player: { destroy: () => void } | undefined;

    function createPlayer() {
      if (destroyed || !iframeRef.current || !window.YT) return;
      const YT = window.YT;
      player = new YT.Player(iframeRef.current, {
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) onStateChange("playing");
            else if (e.data === YT.PlayerState.PAUSED) onStateChange("paused");
            else if (e.data === YT.PlayerState.ENDED) onStateChange("ended");
          },
        },
      });
    }

    if (window.YT) {
      createPlayer();
    } else {
      if (!document.getElementById("youtube-iframe-api")) {
        const script = document.createElement("script");
        script.id = "youtube-iframe-api";
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        createPlayer();
      };
    }

    return () => {
      destroyed = true;
      player?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1`}
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
  const [videoState, setVideoState] = useState<VideoState>("unstarted");
  const activeDot = trackPos % REAL_SLIDES;
  const onVideoSlide = activeDot === 1;

  // No-ops while sitting on the duplicate slide, waiting for the snap-back
  // below — otherwise a click landing in that ~700ms window would push past
  // the end of the track.
  const advance = () => {
    setAnimated(true);
    setTrackPos((p) => (p >= REAL_SLIDES ? p : p + 1));
  };

  // Auto-advance every 15s, except: never advance away from the video slide
  // while it's actually playing, and once they pause it, wait a full 60s
  // (not 15) before moving on — a real "are they still watching" grace
  // period, not just the normal cadence. Resets whenever trackPos or the
  // video's state changes, so resuming/pausing playback re-arms the timer.
  useEffect(() => {
    if (onVideoSlide && videoState === "playing") return;
    const delay = onVideoSlide ? 60_000 : 15_000;
    const id = setTimeout(advance, delay);
    return () => clearTimeout(id);
  }, [trackPos, onVideoSlide, videoState]);

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
    <div className="relative h-[520px] overflow-hidden rounded-2xl bg-black shadow-2xl shadow-primary/20 ring-1 ring-black/5 dark:shadow-black/60 dark:ring-white/10 sm:h-[600px] lg:h-[640px]">
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
          <VideoSlide videoId={videoId} onStateChange={setVideoState} />
        </div>
        <div className="h-full w-full shrink-0" style={{ width: `${100 / (REAL_SLIDES + 1)}%` }}>
          <EventSlide event={event} hosts={hosts} />
        </div>
      </div>

      <button
        type="button"
        aria-label="next slide"
        onClick={advance}
        className="group/next absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-md transition-colors duration-200 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
      >
        <ChevronRight
          size={18}
          strokeWidth={2}
          aria-hidden
          className="transition-transform duration-300 group-hover/next:translate-x-0.5 motion-reduce:transition-none"
        />
      </button>

      <div className="absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 justify-center sm:bottom-2 sm:left-auto sm:right-6 sm:translate-x-0">
        {Array.from({ length: REAL_SLIDES }).map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`go to slide ${i + 1}`}
            onClick={() => {
              if (i !== activeDot) advance();
            }}
            aria-current={i === activeDot ? "true" : undefined}
            className="group/dot flex h-11 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <span
              aria-hidden
              className={`h-1.5 w-6 rounded-full transition-colors duration-200 motion-reduce:transition-none ${
                i === activeDot ? "bg-white" : "bg-white/35 group-hover/dot:bg-white/60"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
