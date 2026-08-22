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
