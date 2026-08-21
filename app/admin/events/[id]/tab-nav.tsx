"use client";

import Link from "next/link";

export function TabNav({
  tabs,
  active,
  eventId,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
  eventId: string;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b text-sm">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/admin/events/${eventId}?tab=${t.key}`}
            className={
              "-mb-px shrink-0 border-b-2 px-2 py-2 sm:px-3 " +
              (isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
