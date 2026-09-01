// The promoted event at the top of /events.
//
// A pinned event isn't "next in line", it's the thing we're pushing, so it
// skips the day rail and renders as a poster: full-bleed art, edge to edge,
// no thumbnail-beside-text row. Two variants:
//
//   BRANDED — an event with an entry in BRAND_KITS below paints its own
//     campaign artwork. Right now that is Hacklanta '26, built from the
//     official design kit (aurora sky, wordmark, stickers, Teko, the
//     ink/lime/violet palette). These are deliberately raw hex values and a
//     third typeface: the surface is a partner brand's poster embedded in our
//     feed, so it does not follow the app theme and must not (DESIGN.md §2's
//     "never a raw palette color" rule is about surfaces that should track
//     the theme — this one is fixed dark by design, in both app themes).
//
//   COVER — everything else. The event's own cover image, full-bleed, under
//     an ink scrim, with the app's normal type voice. No brand kit needed.

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, MapPin, Sparkles } from "lucide-react";
import { Teko } from "next/font/google";

import { EVENT_TIME_ZONE, formatTimeRange } from "./event-date";

// The kit's display face. Extremely condensed, always uppercase, leading
// ~0.86 — a wider face doesn't survive the swap. preload:false so the file
// is only fetched on a page that actually renders a branded poster.
const teko = Teko({
  variable: "--font-hacklanta",
  weight: ["500", "600"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

// hacklanta-26-design-kit/04-colors/COLORS.md
const INK = "#01030A";
const PAPER = "#FAF7FF";
const LIME = "#F6CE28";
const PINK = "#FF316F";
const CYAN = "#21E6D7";
const VIOLET_SHADOW = "#6A5CFF";
const TICKET_GRADIENT =
  "linear-gradient(90deg,#8CC63E 0%,#F6CE28 52%,#FF9A1A 100%)";

type BrandKit = {
  /** Tracked label above the wordmark. 07-copy/COPY.md, masthead. */
  eyebrow: string;
  wordmark: { src: string; alt: string; width: number; height: number };
  tagline: string;
  /** The flyer's venue line. events.location_text is "Location TBD, see
   *  hacklanta.dev" — a fallback string for the generic card, not poster
   *  copy, so the ticket bar uses the published flyer's venue instead. */
  venue: string;
  /** The one loud number. Lime is rationed to this and the URL. */
  headline: string;
  cta: string;
  /** The flyer's fine print. Carries the urgency the card would otherwise
   *  lose — the event has no in-platform RSVP, so nothing else says it. */
  fineprint: string;
  /** The official published flyer, already carrying its own wordmark, dates,
   *  sponsors, and QR — when set, this replaces the hand-composited poster
   *  below instead of layering our own text over it. */
  flyer?: { src: string; alt: string; width: number; height: number };
};

const BRAND_KITS: Record<string, BrandKit> = {
  "hacklanta-ii": {
    eyebrow: "Progsu presents the second Hacklanta",
    wordmark: {
      src: "/hacklanta/wordmark.webp",
      alt: "Hacklanta '26",
      width: 760,
      height: 597,
    },
    tagline: "Different rhythm, higher stakes",
    venue: "Georgia State University",
    headline: "$20,000 in prizes",
    cta: "hacklanta.dev",
    fineprint: "Free for accepted participants. Seats are limited.",
    flyer: {
      src: "/hacklanta/flyer.png",
      alt: "Hacklanta '26 flyer: 3 day hackathon, Oct 9-11, SCE at Georgia State, win prizes up to $20,000, RSVP at hacklanta.dev",
      width: 1024,
      height: 819,
    },
  },
};

export type PinnedHeroItem = {
  href: string;
  slug: string;
  title: string;
  hosts: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  coverUrl: string | null;
};

export function PinnedEventHero({ item }: { item: PinnedHeroItem }) {
  const kit = BRAND_KITS[item.slug];
  return kit ? (
    <BrandedPoster item={item} kit={kit} />
  ) : (
    <CoverPoster item={item} />
  );
}

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

// One link, one rounded clip, one hover lift. Both variants fill it edge to
// edge — the whole card is the artwork, so nothing inside gets its own
// border or background plate.
function PosterShell({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={{ backgroundColor: INK }}
    >
      {children}
    </Link>
  );
}

// Tracked uppercase label. 0.28em is what makes it read as a label rather
// than small body copy (03-fonts/FONTS.md).
function PosterLabel({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  return (
    <span
      className="text-[10px] font-bold uppercase leading-[1.5] tracking-[0.28em] sm:text-[11px]"
      style={{ color }}
    >
      {children}
    </span>
  );
}

function FeaturedChip({ color }: { color: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.16em]"
      style={{
        color,
        borderColor: `${color}59`,
        backgroundColor: `${color}1f`,
      }}
    >
      <Sparkles size={11} strokeWidth={2.25} aria-hidden />
      Featured
    </span>
  );
}

// ---------------------------------------------------------------------------
// Branded poster
// ---------------------------------------------------------------------------

function BrandedPoster({
  item,
  kit,
}: {
  item: PinnedHeroItem;
  kit: BrandKit;
}) {
  if (kit.flyer) {
    return (
      <div className="max-w-[538px] sm:ml-[9.5rem]">
        <PosterShell href={item.href}>
          <Image
            src={kit.flyer.src}
            alt={kit.flyer.alt}
            width={kit.flyer.width}
            height={kit.flyer.height}
            priority
            className="h-auto w-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </PosterShell>
      </div>
    );
  }

  return (
    <PosterShell href={item.href}>
      <div className={`${teko.variable} relative isolate`}>
        {/* Layer 1 — the sky. A landscape band cut from the flyer's finished
            background: dark ink on the left for the type column, the rainbow
            sweep rising into the right where the stickers sit. */}
        <Image
          src="/hacklanta/sky.webp"
          alt=""
          aria-hidden
          fill
          priority
          sizes="(max-width: 768px) 100vw, 768px"
          className="-z-20 object-cover object-right transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />

        {/* Layer 2 — the scrim that buys the type its contrast. Horizontal on
            desktop (type left, art right); vertical on mobile, where the
            column runs the full width. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 sm:hidden"
          style={{
            background: `linear-gradient(to bottom, ${INK}f2 0%, ${INK}e6 52%, ${INK}b3 100%)`,
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 hidden sm:block"
          style={{
            background: `linear-gradient(100deg, ${INK} 0%, ${INK}f7 34%, ${INK}c4 58%, ${INK}52 78%, transparent 100%)`,
          }}
        />

        {/* Layer 3 — stickers. Cropped at the trim and rotated, never
            floating politely inside a margin (02-stickers/STICKERS.md). */}
        <Sticker
          src="/hacklanta/saturn.webp"
          width={300}
          height={248}
          className="-right-6 -top-7 w-24 rotate-[9deg] sm:-right-8 sm:-top-9 sm:w-32"
        />
        <Sticker
          src="/hacklanta/computers.webp"
          width={340}
          height={262}
          className="-bottom-6 -right-4 hidden w-28 -rotate-[7deg] sm:block sm:w-36"
        />
        <Sticker
          src="/hacklanta/music-notes.webp"
          width={240}
          height={229}
          className="-bottom-5 right-28 hidden w-16 rotate-[11deg] lg:block"
        />

        {/* Content */}
        <div className="relative flex flex-col gap-4 p-5 sm:max-w-[62%] sm:gap-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <FeaturedChip color={LIME} />
            <PosterLabel color={CYAN}>{kit.eyebrow}</PosterLabel>
          </div>

          <div className="space-y-2.5">
            <h2>
              <Image
                src={kit.wordmark.src}
                alt={kit.wordmark.alt}
                width={kit.wordmark.width}
                height={kit.wordmark.height}
                className="h-[4.5rem] w-auto sm:h-[5.5rem]"
              />
            </h2>
            <p
              className="text-xs font-semibold uppercase tracking-[0.2em] sm:text-[13px]"
              style={{ color: PAPER }}
            >
              {kit.tagline}
            </p>
          </div>

          <TicketBar
            dates={posterDateRange(item.startsAt, item.endsAt)}
            venue={kit.venue}
          />

          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            {/* The money line. Teko at 0.86 leading, lime over a hard pink
                offset — no blur; a soft shadow reads as a generic web
                button and is the fastest way to lose the poster. */}
            <p
              className="font-[family-name:var(--font-hacklanta)] text-[2.5rem] font-semibold uppercase tabular-nums sm:text-5xl"
              style={{
                color: LIME,
                lineHeight: 0.86,
                textShadow: `3px 3px 0 ${PINK}`,
              }}
            >
              {kit.headline}
            </p>
            <span
              className="inline-flex items-center gap-1 font-[family-name:var(--font-hacklanta)] text-[1.75rem] font-semibold leading-none sm:text-3xl"
              style={{ color: LIME }}
            >
              <span className="underline decoration-transparent underline-offset-4 transition-colors duration-200 group-hover:decoration-current motion-reduce:transition-none">
                {kit.cta}
              </span>
              <ArrowUpRight
                size={20}
                strokeWidth={2.5}
                aria-hidden
                className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
              />
            </span>
          </div>

          <p
            className="text-[11px] leading-relaxed"
            style={{ color: `${PAPER}8c` }}
          >
            {kit.fineprint}
          </p>
        </div>
      </div>
    </PosterShell>
  );
}

function Sticker({
  src,
  width,
  height,
  className,
}: {
  src: string;
  width: number;
  height: number;
  className: string;
}) {
  return (
    <Image
      src={src}
      alt=""
      aria-hidden
      width={width}
      height={height}
      className={`pointer-events-none absolute -z-10 h-auto select-none ${className}`}
    />
  );
}

// The kit's signature element: lime-to-orange gradient, ink text, and a hard
// violet offset pushed down and to the left. No blur anywhere on it.
function TicketBar({ dates, venue }: { dates: string; venue: string }) {
  return (
    <div
      className="inline-flex w-fit max-w-full items-center gap-3 self-start rounded-lg px-3.5 py-2 sm:gap-4 sm:px-4"
      style={{
        background: TICKET_GRADIENT,
        boxShadow: `-4px 4px 0 0 ${VIOLET_SHADOW}`,
      }}
    >
      <span
        className="whitespace-nowrap font-[family-name:var(--font-hacklanta)] text-2xl font-semibold uppercase leading-none tabular-nums sm:text-[1.75rem]"
        style={{ color: INK }}
      >
        {dates}
      </span>
      <span
        aria-hidden
        className="h-5 w-px shrink-0"
        style={{ backgroundColor: `${INK}59` }}
      />
      <span
        className="text-[10px] font-bold uppercase leading-tight tracking-[0.14em] sm:text-[11px]"
        style={{ color: INK }}
      >
        {venue}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cover poster — the fallback for any pinned event without a brand kit
// ---------------------------------------------------------------------------

function CoverPoster({ item }: { item: PinnedHeroItem }) {
  const dateLabel = `${posterDateRange(item.startsAt, item.endsAt)} · ${formatTimeRange(
    item.startsAt,
    item.endsAt
  )}`;

  return (
    <PosterShell href={item.href}>
      <div className="relative isolate min-h-[15rem] sm:min-h-[17rem]">
        {item.coverUrl ? (
          <>
            {/* Signed Supabase URL — next/image can't optimise it, same
                reason as the cover thumbnails on EventCard. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.coverUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
            <div
              aria-hidden
              className="absolute inset-0 -z-10"
              style={{
                background: `linear-gradient(to top, ${INK}fa 8%, ${INK}d9 46%, ${INK}59 100%)`,
              }}
            />
          </>
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background: `radial-gradient(120% 120% at 15% 0%, #2A1B5E 0%, ${INK} 62%)`,
            }}
          />
        )}

        <div className="relative flex h-full min-h-[15rem] flex-col justify-end gap-3 p-5 sm:min-h-[17rem] sm:p-7">
          <FeaturedChip color={PAPER} />
          <h2
            className="text-3xl font-bold tracking-tight sm:text-4xl"
            style={{ color: PAPER }}
          >
            {item.title}
          </h2>
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm"
            style={{ color: `${PAPER}b8` }}
          >
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <CalendarDays size={14} strokeWidth={1.75} aria-hidden />
              {dateLabel}
            </span>
            {item.location ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                <span className="truncate">{item.location}</span>
              </span>
            ) : null}
          </div>
          {item.hosts ? (
            <p className="text-sm" style={{ color: `${PAPER}8f` }}>
              By {item.hosts}
            </p>
          ) : null}
        </div>
      </div>
    </PosterShell>
  );
}

// ---------------------------------------------------------------------------

const posterMonthDay = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
  day: "numeric",
});
const posterDay = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  day: "numeric",
});
const posterMonth = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
});

// "Oct 9 – 11" for a multi-day run inside one month, "Oct 30 – Nov 1" across
// a boundary, "Oct 9" for a single day. Formatted in EVENT_TIME_ZONE for the
// same reason every other date on this surface is — a UTC-evening start
// otherwise lands on tomorrow.
function posterDateRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startLabel = posterMonthDay.format(start);
  if (posterMonthDay.format(end) === startLabel) return startLabel;
  if (posterMonth.format(end) === posterMonth.format(start)) {
    return `${startLabel} – ${posterDay.format(end)}`;
  }
  return `${startLabel} – ${posterMonthDay.format(end)}`;
}
