import Link from "next/link";
import { Search } from "lucide-react";

import { getOwnVisibilitySettings, listMemberCards } from "@/lib/actions/members";

import { VisibilityNudge } from "./_components/visibility-nudge";
import {
  MemberConstellation,
  type ConstellationMember,
} from "./_components/member-constellation";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  cursor_ts?: string;
  cursor_user?: string;
};

const PAGE_SIZE = 24;

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
      cursor_ts: params.cursor_ts ?? null,
      cursor_user: params.cursor_user ?? null,
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
  const last = cards.length === PAGE_SIZE ? cards[cards.length - 1] : null;
  const nextQs = last
    ? new URLSearchParams({
        ...(q ? { q } : {}),
        cursor_ts: last.visible_since ?? "",
        cursor_user: last.user_id,
      }).toString()
    : null;

  const members: ConstellationMember[] = cards.map((card) => ({
    userId: card.user_id,
    name: card.display_name ?? "Member",
    avatarUrl: card.avatar_url,
    slug: card.profile_slug,
    school: card.school,
    classStanding: card.class_standing,
    gradLabel:
      card.grad_term && card.grad_year
        ? card.grad_term
        : card.grad_year
          ? `Class of ${card.grad_year}`
          : null,
    roles: (card.interested_roles ?? []).slice(0, 3),
  }));

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
        // Remount on a new result set so the viewer starts at the origin
        // instead of parked over lattice that no longer has anyone on it.
        <MemberConstellation
          key={`${q}|${params.cursor_user ?? ""}`}
          members={members}
        />
      )}

      {nextQs ? (
        <div className="flex justify-center">
          <Link
            href={`/members?${nextQs}`}
            className="rounded-full border border-border px-5 py-2 text-sm transition-colors hover:bg-muted/60"
          >
            Next page
          </Link>
        </div>
      ) : null}
    </div>
  );
}
