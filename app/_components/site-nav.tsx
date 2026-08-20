"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Shared member-area nav (Events/Members). Previously each of
// app/profile, app/members, app/events hand-rolled its own header and
// they'd drifted: dashboard linked to neither Members nor Events at all.
// One nav, used by all three layouts, so that can't happen again.
// Profile lives in the header avatar menu, not here.
export function SiteNav({
  showMembers,
  showEvents,
}: {
  showMembers: boolean;
  showEvents: boolean;
}) {
  const pathname = usePathname() ?? "";

  type Item = { href: string; label: string; icon: LucideIcon; active: boolean };
  const items: Item[] = [];
  if (showEvents) {
    items.push({
      href: "/events",
      label: "Events",
      icon: CalendarDays,
      active: pathname.startsWith("/events"),
    });
  }
  if (showMembers) {
    items.push({
      href: "/members",
      label: "Members",
      icon: Users,
      active: pathname.startsWith("/members"),
    });
  }
  return (
    <>
      {items.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors " +
            (active
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
          }
        >
          <Icon size={15} strokeWidth={1.75} aria-hidden />
          {label}
        </Link>
      ))}
    </>
  );
}
