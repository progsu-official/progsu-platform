import { Search } from "lucide-react";

import { getOwnVisibilitySettings, listMemberCards } from "@/lib/actions/members";

import { VisibilityNudge } from "./_components/visibility-nudge";
import { MemberConstellation } from "./_components/member-constellation";
import {
  cursorAfter,
  toConstellationMember,
} from "./_components/constellation-data";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
};

// The canvas is near-viewport-sized now, so a first page has to cover a lot of
// lattice before the auto-fill in MemberConstellation starts topping it up.
// 100 is the hard cap inside list_member_cards.
const PAGE_SIZE = 60;

export default async function MembersDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();

  const [result, ownVisibility] = await Promise.all([
    listMemberCards({
      search: q.length > 0 ? q : null,
      limit: PAGE_SIZE,
    }),
    getOwnVisibilitySettings(),
  ]);
  // A null row means the viewer has no visibility settings yet, which is the
  // same story as discoverable=false: they aren't in the directory.
  const hiddenFromDirectory =
    ownVisibility.ok && !ownVisibility.data?.discoverable;

  if (!result.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Members</h1>
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {result.error.message}
        </p>
      </div>
    );
  }

  const cards = result.data;
  const members = cards.map(toConstellationMember);

  return (
    <div className="space-y-10 pt-2 sm:pt-6">
      <header className="space-y-1.5">
        <h1 className="text-5xl font-extrabold leading-none tracking-[-0.035em] sm:text-6xl">Members</h1>
      </header>

      {hiddenFromDirectory ? <VisibilityNudge /> : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <form method="get" className="relative w-full max-w-sm">
          <Search
            size={15}
            strokeWidth={1.75}
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name"
            className="glass h-11 w-full rounded-full pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
            maxLength={64}
          />
        </form>
        {members.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Drag to explore. Click a face to open their profile.
          </p>
        ) : null}
      </div>

      {members.length === 0 ? (
        <div className="rounded-2xl glass px-8 py-16 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <Search size={22} strokeWidth={1.75} aria-hidden />
          </div>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {q
              ? `No members match "${q}".`
              : "No members have opted into the directory yet."}
          </p>
        </div>
      ) : (
        // Remount on a new search so the viewer starts at the origin instead
        // of parked over lattice that no longer has anyone on it.
        <MemberConstellation
          key={q}
          initialMembers={members}
          initialCursor={cursorAfter(cards, PAGE_SIZE)}
          search={q.length > 0 ? q : null}
        />
      )}
    </div>
  );
}
