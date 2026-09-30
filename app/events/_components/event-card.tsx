// Shared card used by the member events list (app/events/page.tsx) and the
// admin events list (app/admin/events/page.tsx). Extracted so both surfaces
// render the same visual language — cover thumbnail, title, host, date/time,
// location, footer stat — instead of the admin side reinventing a plain
// text row. See DESIGN.md §6 "Card".

import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";

import { EVENT_TIME_ZONE, formatTimeRange } from "./event-date";

const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
  day: "numeric",
});

export type HostRef = { display_name: string; sort_order: number };

export function joinHosts(hosts: HostRef[] | null | undefined): string | null {
  if (!hosts || hosts.length === 0) return null;
  const sorted = [...hosts].sort((a, b) => a.sort_order - b.sort_order);
  return sorted.map((h) => h.display_name).join(", ");
}

export function EventCard({
  href,
  title,
  hosts,
  startsAt,
  endsAt,
  location,
  cancelled,
  coverUrl,
  footer,
  showDate,
  variant = "member",
}: {
  href: string;
  title: string;
  hosts: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  cancelled?: boolean;
  coverUrl?: string | null;
  footer?: React.ReactNode;
  showDate?: boolean;
  // "member" surfaces sit on the ambient field and can use `.glass`.
  // "admin" has no ambient field (DESIGN.md's "two rooms" split) — same
  // card layout, but a flat bordered surface instead, matching the admin
  // dashboard's `rounded-2xl border border-border/70 bg-card` pattern.
  variant?: "member" | "admin";
}) {
  const timeLabel = showDate
    ? `${monthDayFormatter.format(new Date(startsAt))} · ${formatTimeRange(startsAt, endsAt)}`
    : formatTimeRange(startsAt, endsAt);
  const surface =
    variant === "admin"
      ? "border border-border/70 bg-card hover:border-border hover:shadow-sm"
      : "glass glass-interactive";
  return (
    <li className="list-none">
      <Link
        href={href}
        style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        className={`group flex gap-4 rounded-2xl ${surface} p-4 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-5`}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold tabular-nums text-muted-foreground">
            <time dateTime={startsAt}>{timeLabel}</time>
          </p>
          <h3
            className={
              (variant === "member"
                ? "text-xl font-bold leading-tight "
                : "text-lg font-semibold leading-snug ") +
              "tracking-tight transition-colors duration-200 group-hover:text-primary " +
              (cancelled ? "text-muted-foreground line-through" : "text-foreground")
            }
          >
            {title}
          </h3>
          {hosts ? (
            <p className="truncate text-sm text-muted-foreground">By {hosts}</p>
          ) : null}
          {location ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span className="truncate">{location}</span>
            </p>
          ) : null}
          {footer ? <div className="pt-1.5 text-xs">{footer}</div> : null}
        </div>
        <div
          className={
            "relative h-24 w-24 shrink-0 self-start overflow-hidden rounded-xl bg-gradient-to-br from-muted to-primary/20 ring-1 ring-inset ring-foreground/5 sm:h-32 sm:w-32 " +
            (cancelled ? "opacity-50 grayscale" : "")
          }
        >
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <CalendarDays
                size={22}
                strokeWidth={1.5}
                className="text-muted-foreground/60"
                aria-hidden
              />
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
