import Link from "next/link";

import { signOut } from "@/lib/actions/session";

import { Avatar } from "./avatar";
import { SiteNav } from "./site-nav";

// One header for every member surface (dashboard/members/events layouts).
// Sticky + frosted so the timeline scrolls underneath it Luma-style.
export function MemberHeader({
  displayName,
  avatarUrl,
  isAdmin,
  showMembers,
  showEvents,
}: {
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  showMembers: boolean;
  showEvents: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <Link
          href="/dashboard"
          className="flex items-baseline gap-1.5 text-[15px] font-bold tracking-tight text-foreground"
        >
          progsu
          <span
            title="Progsu is in beta — things may move around while we build."
            className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-widest text-primary"
          >
            beta
          </span>
        </Link>

        <nav className="flex items-center gap-0.5">
          <SiteNav showMembers={showMembers} showEvents={showEvents} />
        </nav>

        <div className="flex items-center gap-2.5">
          {isAdmin ? (
            <Link
              href="/admin"
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              Admin
            </Link>
          ) : null}
          <Link
            href="/dashboard"
            aria-label={`${displayName}'s profile`}
            className="shrink-0"
          >
            <Avatar
              src={avatarUrl}
              name={displayName}
              className="h-8 w-8 rounded-full"
            />
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
