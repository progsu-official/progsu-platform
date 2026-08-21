"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AtSign,
  CalendarDays,
  Download,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

// Overview is exact-match so it doesn't stay lit on every /admin/* route.
const ITEMS: Item[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/members", label: "Members", icon: Users },
  { href: "/admin/events", label: "Events", icon: CalendarDays },
  { href: "/admin/export", label: "Export", icon: Download },
  { href: "/admin/domain-requests", label: "Domain requests", icon: AtSign },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

// horizontal: the same items as a scrollable icon-only strip, for the mobile
// top bar — the sidebar above is `md:flex` only, so phones get no nav at all
// without this.
export function AdminNav({
  showEvents,
  horizontal,
}: {
  showEvents: boolean;
  horizontal?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const items = ITEMS.filter((i) => showEvents || i.href !== "/admin/events");

  return (
    <nav
      className={
        horizontal
          ? "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scroll-fade-x"
          : "flex-1 space-y-0.5 px-3 py-3"
      }
    >
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={horizontal ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={
              horizontal
                ? "flex shrink-0 items-center rounded-lg p-2.5 transition-colors " +
                  (active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground")
                : "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors " +
                  (active
                    ? "bg-primary/15 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
            }
          >
            <Icon
              size={15}
              strokeWidth={1.75}
              aria-hidden
              className={horizontal ? undefined : active ? "text-primary" : "text-muted-foreground/70"}
            />
            {horizontal ? null : label}
          </Link>
        );
      })}
    </nav>
  );
}
