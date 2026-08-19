import Link from "next/link";

import { ProfileMenu } from "./profile-menu";
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
          <ProfileMenu
            displayName={displayName}
            avatarUrl={avatarUrl}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    </header>
  );
}
