import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import { EVENT_TIME_ZONE } from "@/app/events/_components/event-date";

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
});
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  day: "numeric",
});

export type AttendedEvent = {
  event_id: string;
  slug: string;
  title: string;
  starts_at: string;
};

// Same cover-forward card language as UpcomingEvents, past tense: a date
// plate instead of a status chip, since there's nothing left to RSVP to.
export function AttendedEvents({
  events,
  coverUrls,
  emptyLabel = "No attended events to show.",
}: {
  events: AttendedEvent[];
  coverUrls: Array<string | null>;
  emptyLabel?: string;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((ev, i) => (
        <AttendedEventCard key={ev.event_id} event={ev} coverUrl={coverUrls[i] ?? null} />
      ))}
    </ul>
  );
}

function AttendedEventCard({
  event,
  coverUrl,
}: {
  event: AttendedEvent;
  coverUrl: string | null;
}) {
  const start = new Date(event.starts_at);
  return (
    <li>
      <Link
        href={`/events/${event.slug}`}
        className="group flex h-full flex-col overflow-hidden rounded-2xl glass glass-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-muted to-primary/20">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <CalendarCheck
                size={24}
                strokeWidth={1.5}
                className="text-muted-foreground/50"
                aria-hidden
              />
            </div>
          )}
          <time
            dateTime={event.starts_at}
            className="absolute left-3 top-3 flex w-11 flex-col items-center rounded-xl bg-background/90 py-1.5 text-center ring-1 ring-inset ring-black/5 dark:ring-white/10"
          >
            <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
              {monthFormatter.format(start)}
            </span>
            <span className="mt-1 text-lg font-bold leading-none tabular-nums text-foreground">
              {dayFormatter.format(start)}
            </span>
          </time>
        </div>
        <div className="flex flex-1 items-center justify-between gap-2 p-4">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
            {event.title}
          </h3>
          <CalendarCheck
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-primary"
            aria-hidden
          />
        </div>
      </Link>
    </li>
  );
}
