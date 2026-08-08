"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Shared member-area nav (Dashboard/Members/Events/Settings). Previously each
// of app/dashboard, app/members, app/events hand-rolled its own header and
// they'd drifted: dashboard linked to neither Members nor Events at all.
// One nav, used by all three layouts, so that can't happen again.
export function SiteNav({
  showMembers,
  showEvents,
  isAdmin,
}: {
  showMembers: boolean;
  showEvents: boolean;
  isAdmin: boolean;
}) {
  const pathname = usePathname() ?? "";

  const linkClass = (active: boolean) =>
    active
      ? "font-medium text-foreground"
      : "text-muted-foreground transition-colors hover:text-foreground";

  return (
    <>
      <Link
        href="/dashboard"
        aria-current={pathname === "/dashboard" ? "page" : undefined}
        className={linkClass(pathname === "/dashboard")}
      >
        Dashboard
      </Link>
      {showMembers ? (
        <Link
          href="/members"
          aria-current={pathname.startsWith("/members") ? "page" : undefined}
          className={linkClass(pathname.startsWith("/members"))}
        >
          Members
        </Link>
      ) : null}
      {showEvents ? (
        <Link
          href="/events"
          aria-current={pathname.startsWith("/events") ? "page" : undefined}
          className={linkClass(pathname.startsWith("/events"))}
        >
          Events
        </Link>
      ) : null}
      <Link
        href="/dashboard/settings"
        aria-current={pathname === "/dashboard/settings" ? "page" : undefined}
        className={linkClass(pathname === "/dashboard/settings")}
      >
        Settings
      </Link>
      {isAdmin ? (
        <Link
          href="/admin"
          className="rounded-md border border-input px-2 py-1 text-xs font-medium transition-colors hover:bg-accent/10"
        >
          Admin
        </Link>
      ) : null}
    </>
  );
}
