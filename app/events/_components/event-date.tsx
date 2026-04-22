// Small presentational helpers for event date formatting. We render on the
// server with the machine's locale/timezone context; where a client-local
// value is required we would swap to a client island, but the list view can
// tolerate server-rendered time strings because pages are force-dynamic.

type Props = {
  startsAt: string;
  endsAt?: string | null;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function formatEventWindow(startsAt: string, endsAt?: string | null) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return startsAt;
  const startLabel = dateFormatter.format(start);
  if (!endsAt) return startLabel;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return startLabel;
  // Same-day events: compress to "<date>, <startTime> – <endTime>".
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (sameDay) {
    return `${startLabel} – ${timeFormatter.format(end)}`;
  }
  return `${startLabel} → ${dateFormatter.format(end)}`;
}

export function EventDate({ startsAt, endsAt }: Props) {
  return <time dateTime={startsAt}>{formatEventWindow(startsAt, endsAt)}</time>;
}
