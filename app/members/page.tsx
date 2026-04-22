import Link from "next/link";

import { listMemberCards } from "@/lib/actions/members";

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

  const result = await listMemberCards({
    search: q.length > 0 ? q : null,
    cursor_ts: params.cursor_ts ?? null,
    cursor_user: params.cursor_user ?? null,
    limit: PAGE_SIZE,
  });

  if (!result.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">
          Progsu members who&apos;ve opted into the directory. Turn on your own
          visibility in{" "}
          <Link
            href="/dashboard/settings#visibility"
            className="underline underline-offset-4"
          >
            settings
          </Link>
          .
        </p>
      </header>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name"
          className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
          maxLength={64}
        />
        <button
          type="submit"
          className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent/10"
        >
          Search
        </button>
      </form>

      {cards.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {q
              ? `No members match "${q}".`
              : "No members have opted into the directory yet."}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {cards.map((card) => (
            <li key={card.user_id}>
              {card.profile_slug ? (
                <Link
                  href={`/members/${card.profile_slug}`}
                  className="block rounded-md border p-4 transition hover:border-primary/50 hover:bg-accent/5"
                >
                  <MemberCardPreview card={card} />
                </Link>
              ) : (
                <div className="block rounded-md border p-4 opacity-70">
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
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent/10"
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
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {card.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.avatar_url}
            alt=""
            className="h-10 w-10 rounded-full border object-cover"
          />
        ) : (
          <div className="h-10 w-10 rounded-full border bg-muted" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {card.display_name ?? "Member"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {card.school ?? ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
        {card.class_standing ? (
          <span className="rounded-full border px-2 py-0.5 capitalize">
            {card.class_standing}
          </span>
        ) : null}
        {gradLabel ? (
          <span className="rounded-full border px-2 py-0.5">{gradLabel}</span>
        ) : null}
      </div>
      {topRoles.length > 0 ? (
        <p className="text-xs text-muted-foreground">{topRoles.join(" · ")}</p>
      ) : null}
    </div>
  );
}
