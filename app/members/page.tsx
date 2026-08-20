import Link from "next/link";
import { Search } from "lucide-react";

import { getOwnVisibilitySettings, listMemberCards } from "@/lib/actions/members";
import { Avatar } from "@/app/_components/avatar";

import { VisibilityNudge } from "./_components/visibility-nudge";

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

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-4xl font-bold tracking-tight">Members</h1>
      </header>

      {hiddenFromDirectory ? <VisibilityNudge /> : null}

      <form method="get" className="relative max-w-sm">
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

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 px-8 py-14 text-center">
          <p className="text-sm text-muted-foreground">
            {q
              ? `No members match "${q}".`
              : "No members have opted into the directory yet."}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {cards.map((card) => (
            <li key={card.user_id}>
              {card.profile_slug ? (
                <Link
                  href={`/members/${card.profile_slug}`}
                  className="block h-full rounded-2xl border border-border/70 bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-lg hover:shadow-black/20"
                >
                  <MemberCardPreview card={card} />
                </Link>
              ) : (
                <div className="block h-full rounded-2xl border border-border/70 bg-card p-5 opacity-70">
                  <MemberCardPreview card={card} />
                </div>
              )}
            </li>
          ))}
        </ul>
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

function MemberCardPreview({
  card,
}: {
  card: Awaited<ReturnType<typeof listMemberCards>> extends infer R
    ? R extends { ok: true; data: infer Rows }
      ? Rows extends Array<infer T>
        ? T
        : never
      : never
    : never;
}) {
  const gradLabel =
    card.grad_term && card.grad_year
      ? `${card.grad_term}`
      : card.grad_year
        ? `Class of ${card.grad_year}`
        : null;
  const topRoles = (card.interested_roles ?? []).slice(0, 3);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar
          src={card.avatar_url}
          name={card.display_name ?? "?"}
          className="h-12 w-12 shrink-0 rounded-full"
          textClassName="text-sm"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {card.display_name ?? "Member"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {card.school ?? ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
        {card.class_standing ? (
          <span className="rounded-full border border-border/70 px-2 py-0.5 capitalize">
            {card.class_standing}
          </span>
        ) : null}
        {gradLabel ? (
          <span className="rounded-full border border-border/70 px-2 py-0.5">
            {gradLabel}
          </span>
        ) : null}
      </div>
      {topRoles.length > 0 ? (
        <p className="text-xs text-muted-foreground">{topRoles.join(" · ")}</p>
      ) : null}
    </div>
  );
}
