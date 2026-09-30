import Link from "next/link";

import { HeaderSignInButton } from "./header-sign-in-button";
import { SiteNav } from "./site-nav";
import { UserMenu } from "./user-menu";

// One header for every member surface (dashboard/members/events layouts).
// Sticky + frosted so the timeline scrolls underneath it Luma-style.
// displayName null = signed-out visitor (only reachable today on the public
// event detail page, per the 2026-08-20 RSVP-first decision) — shows a
// sign-in link instead of the account menu.
export function MemberHeader({
  displayName,
  email,
  avatarUrl,
  isAdmin,
  showMembers,
  showEvents,
}: {
  displayName: string | null;
  email?: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  showMembers: boolean;
  showEvents: boolean;
}) {
  return (
    <header className="glass-nav sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4">
        <Link
          href={displayName ? "/profile" : "/"}
          className="flex items-center gap-1.5 rounded-lg text-base font-bold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          progsu
          <span
            title="Progsu is in beta — things may move around while we build."
            className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wider text-primary ring-1 ring-inset ring-primary/25"
          >
            beta
          </span>
        </Link>

        <nav>
          <SiteNav
            showMembers={showMembers}
            showEvents={showEvents}
            signedIn={!!displayName}
          />
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {displayName ? (
            <UserMenu
              displayName={displayName}
              email={email ?? null}
              avatarUrl={avatarUrl}
              isAdmin={isAdmin}
            />
          ) : (
            <HeaderSignInButton />
          )}
        </div>
      </div>
    </header>
  );
}
