import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, MapPin, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EVENT_TIME_ZONE } from "@/app/events/_components/event-date";

// How many plans the dashboard shows. Exported so the query limit and the
// "is there room for the browse card" check can't drift apart.
export const MAX_PLANS = 3;

// Cover-forward cards for "your next plans". The date is lifted out of the
// metadata line and onto the artwork, so a member scanning the dashboard reads
// *when* before they read anything else — the one thing that decides whether
// this row still needs their attention today.

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
});
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  day: "numeric",
});
// Compact enough to sit on one line in a ~320px card: "Aug 24, 5:30 PM".
const whenFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export type UpcomingPlan = {
  event_id: string;
  slug: string;
  title: string;
  starts_at: string;
  status: string;
  location_text: string | null;
  rsvp_status: string | null;
};

export function UpcomingEvents({
  plans,
  coverUrls,
  waitlistPositions,
  goingCounts,
  // "/events?tab=my-plans" only makes sense when these are the viewer's own
  // plans. Viewing someone else's card, there's nowhere equivalent to send
  // a "see all" click to, so omit it rather than link to the viewer's own
  // (unrelated) plans.
  seeAllHref = "/events?tab=my-plans",
}: {
  plans: UpcomingPlan[];
  coverUrls: Array<string | null>;
  waitlistPositions: Map<string, number | null>;
  goingCounts: Map<string, number>;
  seeAllHref?: string | null;
}) {
  return (
    <section aria-labelledby="upcoming-events-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2
          id="upcoming-events-heading"
          className="text-sm font-semibold text-foreground"
        >
          Upcoming events
        </h2>
        {seeAllHref ? (
          <Link
            href={seeAllHref}
            className="rounded-md text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            See all
          </Link>
        ) : null}
      </div>

      {plans.length === 0 ? (
        <EmptyPlans />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan, i) => (
            <PlanCard
              key={plan.event_id}
              plan={plan}
              coverUrl={coverUrls[i] ?? null}
              waitlistPosition={waitlistPositions.get(plan.event_id) ?? null}
              goingCount={goingCounts.get(plan.event_id) ?? null}
            />
          ))}
          {/* Only while there's room left in the row. The query caps at 3, so a
              full row would push this onto a second row on its own — and at
              that point the header's "See all" is the better path anyway. */}
          {plans.length < MAX_PLANS ? <BrowseMoreCard /> : null}
        </ul>
      )}
    </section>
  );
}

function PlanCard({
  plan,
  coverUrl,
  waitlistPosition,
  goingCount,
}: {
  plan: UpcomingPlan;
  coverUrl: string | null;
  waitlistPosition: number | null;
  goingCount: number | null;
}) {
  const start = new Date(plan.starts_at);
  const cancelled = plan.status === "cancelled";
  const waitlisted = plan.rsvp_status === "waitlisted";

  return (
    <li>
      <Link
        href={`/events/${plan.slug}`}
        className="group flex h-full flex-col overflow-hidden rounded-2xl glass glass-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-muted to-primary/20">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className={
                "h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 " +
                (cancelled ? "opacity-50 grayscale" : "")
              }
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <CalendarDays
                size={24}
                strokeWidth={1.5}
                className="text-muted-foreground/50"
                aria-hidden
              />
            </div>
          )}

          {/* Date plate. Sits on arbitrary artwork, so it carries its own
              scrim rather than trusting the image to be dark behind it. */}
          <time
            dateTime={plan.starts_at}
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

        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <h3
            className={
              "line-clamp-2 text-sm font-semibold leading-snug transition-colors group-hover:text-primary " +
              (cancelled ? "text-muted-foreground line-through" : "text-foreground")
            }
          >
            {plan.title}
          </h3>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Clock size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
              <span className="truncate">{whenFormatter.format(start)}</span>
            </span>
            {plan.location_text ? (
              <>
                <span aria-hidden className="text-border">
                  •
                </span>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <MapPin
                    size={13}
                    strokeWidth={1.75}
                    className="shrink-0"
                    aria-hidden
                  />
                  <span className="truncate">{plan.location_text}</span>
                </span>
              </>
            ) : null}
          </div>

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3">
            {goingCount != null && goingCount > 0 ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Users size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
                <span className="truncate tabular-nums">{goingCount} going</span>
              </span>
            ) : (
              <span />
            )}
            <StatusChip
              cancelled={cancelled}
              waitlisted={waitlisted}
              waitlistPosition={waitlistPosition}
            />
          </div>
        </div>
      </Link>
    </li>
  );
}

// Reads as status, not as a control. Every card on this surface is already an
// event the member RSVP'd to, so a button here would be inert by construction.
function StatusChip({
  cancelled,
  waitlisted,
  waitlistPosition,
}: {
  cancelled: boolean;
  waitlisted: boolean;
  waitlistPosition: number | null;
}) {
  const tone = cancelled
    ? "bg-destructive/15 text-destructive"
    : waitlisted
      ? "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
      : "bg-primary/15 text-primary";
  const label = cancelled
    ? "Cancelled"
    : waitlisted
      ? waitlistPosition != null
        ? `Waitlisted #${waitlistPosition}`
        : "Waitlisted"
      : "Going";

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

// Deliberately not styled as an event: dashed and unfilled so it reads as the
// end of the row rather than a fourth thing you signed up for.
function BrowseMoreCard() {
  return (
    <li>
      <Link
        href="/events"
        className="group flex h-full min-h-[11rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary"
        >
          <ArrowRight
            size={18}
            strokeWidth={1.75}
            className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
          />
        </span>
        <span className="text-sm font-medium text-foreground">See more events</span>
        <span className="text-xs text-muted-foreground">
          Everything else coming up
        </span>
      </Link>
    </li>
  );
}

function EmptyPlans() {
  return (
    <div className="rounded-2xl border border-dashed border-border/80 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted/60">
        <CalendarDays
          size={19}
          strokeWidth={1.5}
          className="text-muted-foreground"
          aria-hidden
        />
      </div>
      <p className="text-sm font-medium text-foreground">Nothing on the calendar</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        RSVP to an event and it shows up here with the date, place, and who else
        is going.
      </p>
      <Button asChild size="sm" className="mt-4 rounded-full">
        <Link href="/events">Browse events</Link>
      </Button>
    </div>
  );
}
