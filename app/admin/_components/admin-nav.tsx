"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, LayoutDashboard, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

// Export, Domain requests, Audit log, and Settings aren't top-level anymore —
// they're small/rarely-touched enough to live as quick-link cards on
// Overview instead of permanent nav real estate (see admin/page.tsx).
// Overview is exact-match so it doesn't stay lit on every /admin/* route.
const ITEMS: Item[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/events", label: "Events", icon: CalendarDays },
  { href: "/admin/members", label: "Members", icon: Users },
];

// One horizontal strip for every screen size, top bar only (no more sidebar)
// — icon-only below sm where it scrolls if it ever needs to, icon+label
// above, same convention SiteNav uses on the member side.
export function AdminNav({ showEvents }: { showEvents: boolean }) {
  const pathname = usePathname() ?? "";
  const items = ITEMS.filter((i) => showEvents || i.href !== "/admin/events");

  return (
    <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden scroll-fade-x sm:gap-2">
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-current={active ? "page" : undefined}
            className={
              "flex shrink-0 items-center gap-1.5 rounded-lg p-2.5 text-sm transition-colors sm:px-3 " +
              (active
                ? "bg-primary/15 font-medium text-primary"
                : "text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground")
            }
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
