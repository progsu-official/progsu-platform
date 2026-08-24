"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { EventCard } from "@/app/events/_components/event-card";

export type AttendedEvent = {
  event_id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text?: string | null;
};

// The toggle itself is a card, all-or-none: collapsed shows just the count,
// expanded reveals the same bordered EventCard rows used on /events, so past
// events keep that visual language rather than a flat divided list.
export function AttendedEvents({
  events,
  coverUrls,
  emptyLabel = "No attended events to show.",
}: {
  events: AttendedEvent[];
  coverUrls: Array<string | null>;
  emptyLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 rounded-2xl glass p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="text-sm font-medium text-foreground">
          {events.length} event{events.length === 1 ? "" : "s"} attended
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ul className="space-y-4">
          {events.map((ev, i) => (
            <EventCard
              key={ev.event_id}
              href={`/events/${ev.slug}`}
              title={ev.title}
              hosts={null}
              startsAt={ev.starts_at}
              endsAt={ev.ends_at}
              location={ev.location_text ?? null}
              coverUrl={coverUrls[i] ?? null}
              showDate
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
