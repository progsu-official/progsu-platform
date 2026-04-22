"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Small client-side nav block so we can mark the Events link "active" based on
// pathname. The rest of the header (sign-out form, name) stays in the server
// layout.
export function EventsNav() {
  const pathname = usePathname() ?? "";
  const onEvents = pathname === "/events" || pathname.startsWith("/events/");

  return (
    <>
      <Link
        href="/dashboard"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        Dashboard
      </Link>
      <Link
        href="/events"
        aria-current={onEvents ? "page" : undefined}
        className={
          onEvents
            ? "font-medium text-foreground"
            : "text-muted-foreground transition-colors hover:text-foreground"
        }
      >
        Events
      </Link>
      <Link
        href="/dashboard/settings"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        Settings
      </Link>
    </>
  );
}
