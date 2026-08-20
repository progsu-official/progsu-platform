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
    <div className="space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-4xl font-bold tracking-tight">Members</h1>
      </header>

      {hiddenFromDirectory ? <VisibilityNudge /> : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <form method="get" className="relative w-full max-w-sm">
          <Search
            size={15}
            strokeWidth={1.75}
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name"
            className="w-full rounded-full border border-border/70 bg-card py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <div className="rounded-2xl border border-dashed border-border/80 px-8 py-14 text-center">
          <p className="text-sm text-muted-foreground">
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
