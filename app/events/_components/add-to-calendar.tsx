"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarPlus } from "lucide-react";

// Hand-rolled per this app's own convention (see app/_components/user-menu.tsx):
// one dropdown isn't worth a menu-library dependency.
//
// events.starts_at/ends_at are bare UTC instants (see event-date.tsx) — no
// zone conversion needed here, every format below just wants the raw UTC
// stamp, so there's no DST/timezone math to get wrong.

type Props = {
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  eventUrl: string;
};

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

function googleCalendarHref({ title, location, startsAt, endsAt, eventUrl }: Props) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${utcStamp(startsAt)}/${utcStamp(endsAt ?? startsAt)}`,
    location: location ?? "",
    details: eventUrl,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function outlookHref({ title, location, startsAt, endsAt, eventUrl }: Props) {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: title,
    startdt: new Date(startsAt).toISOString(),
    enddt: new Date(endsAt ?? startsAt).toISOString(),
    location: location ?? "",
    body: eventUrl,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}

// Escapes the characters iCalendar's RFC 5545 text values treat as special.
function icsEscape(text: string): string {
  return text.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function icsFile({ title, location, startsAt, endsAt, eventUrl }: Props): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Progsu//Events//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@progsu.com`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    `DTSTART:${utcStamp(startsAt)}`,
    `DTEND:${utcStamp(endsAt ?? startsAt)}`,
    `SUMMARY:${icsEscape(title)}`,
    location ? `LOCATION:${icsEscape(location)}` : null,
    `DESCRIPTION:${icsEscape(eventUrl)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);
  return lines.join("\r\n");
}

function downloadIcs(props: Props) {
  const blob = new Blob([icsFile(props)], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${props.title.replace(/[^\w-]+/g, "-")}.ics`;
  link.click();
  URL.revokeObjectURL(href);
}

const itemClass =
  "block w-full rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus:bg-muted focus:outline-none";

export function AddToCalendarButton(props: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="glass glass-interactive inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <CalendarPlus size={16} strokeWidth={1.75} aria-hidden />
        Add to calendar
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Add to calendar"
          className="absolute left-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-xl border border-border/80 bg-popover p-1.5 shadow-xl shadow-black/10 dark:shadow-black/40"
        >
          <a
            href={googleCalendarHref(props)}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            Google Calendar
          </a>
          <a
            href={outlookHref(props)}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            Outlook
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              downloadIcs(props);
              setOpen(false);
            }}
            className={itemClass}
          >
            Apple / other (.ics)
          </button>
        </div>
      ) : null}
    </div>
  );
}
