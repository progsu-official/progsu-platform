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
    <nav className="flex flex-wrap gap-1 border-b text-sm">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/admin/events/${eventId}?tab=${t.key}`}
            className={
              "-mb-px border-b-2 px-3 py-2 " +
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
