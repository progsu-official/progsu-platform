// Small presentational helpers for event date formatting. Events aren't
// stored with a timezone (events.starts_at/ends_at are bare UTC instants —
// see the composer's wallTimeToUtcIso), so there's no "correct" zone to
// recover at render time unless we pin one. Intl.DateTimeFormat(undefined)
// used to fall through to the *runtime's* zone, which is the viewer's device
// on the client but UTC on Vercel's servers — the same event rendered 4
// hours apart depending on where it happened to render. Every progsu event
// is Eastern in practice, so pin it explicitly instead of leaving it ambient.
export const EVENT_TIME_ZONE = "America/New_York";

type Props = {
  startsAt: string;
  endsAt?: string | null;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

// Zoned "YYYY-MM-DD" for same-day comparisons — Date's own getFullYear/
// getMonth/getDate read the runtime's ambient zone, which is exactly the
// bug above; comparing the formatted-in-EVENT_TIME_ZONE key sidesteps it.
// Exported so other event surfaces (day-grouping timelines, etc.) don't
// reach for the ambient getters themselves.
const dayKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function zonedDayKey(d: Date): string {
  return dayKeyFormatter.format(d);
}
function dayKey(d: Date): string {
  return zonedDayKey(d);
}

/** Midnight (UTC-anchored) of `d`'s calendar day in EVENT_TIME_ZONE — a
 * zone-agnostic value safe to subtract for day-count diffs. */
export function zonedDayStartUtcMs(d: Date): number {
  const parts = dayKeyFormatter.formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

export function formatEventWindow(startsAt: string, endsAt?: string | null) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return startsAt;
  const startLabel = dateFormatter.format(start);
  if (!endsAt) return startLabel;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return startLabel;
  // Same-day events: compress to "<date>, <startTime> – <endTime>".
  if (dayKey(start) === dayKey(end)) {
    return `${startLabel} – ${timeFormatter.format(end)}`;
  }
  return `${startLabel} → ${dateFormatter.format(end)}`;
}

// Time-only range for timeline rows where the surrounding group already
// names the day ("2:30 PM – 5:30 PM"). Falls back to the full window when
// the event crosses midnight.
export function formatTimeRange(startsAt: string, endsAt?: string | null) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return startsAt;
  if (!endsAt) return timeFormatter.format(start);
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return timeFormatter.format(start);
  if (dayKey(start) !== dayKey(end)) return formatEventWindow(startsAt, endsAt);
  return `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
}

export function EventDate({ startsAt, endsAt }: Props) {
  return <time dateTime={startsAt}>{formatEventWindow(startsAt, endsAt)}</time>;
}
