"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Eye, FileText, Mail, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Ordered by how often a member actually opens it, not by how the data is
// modelled. Profile is edited repeatedly while a profile is being completed;
// account email and notifications are set once and revisited rarely, so they
// sit at the bottom.
type Item = { href: string; label: string; icon: LucideIcon };

const BASE: Item[] = [
  { href: "/profile/settings", label: "Profile", icon: UserRound },
  { href: "/profile/settings/resume", label: "Resume", icon: FileText },
];
const VISIBILITY: Item = {
  href: "/profile/settings/visibility",
  label: "Visibility",
  icon: Eye,
};
const TAIL: Item[] = [
  { href: "/profile/settings/account", label: "Account", icon: Mail },
  { href: "/profile/settings/notifications", label: "Notifications", icon: Bell },
];

export function SettingsNav({ showVisibility }: { showVisibility: boolean }) {
  const pathname = usePathname() ?? "";
  const items = [...BASE, ...(showVisibility ? [VISIBILITY] : []), ...TAIL];

  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-20">
      {/* Horizontal and scrollable on small screens, a rail on large ones. */}
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {items.map(({ href, label, icon: Icon }) => {
          // Exact match for the index so it isn't active on every child route.
          const active =
            href === "/profile/settings"
              ? pathname === href
              : pathname.startsWith(href);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
                }
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
