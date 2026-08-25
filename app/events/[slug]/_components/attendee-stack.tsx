import Link from "next/link";

import { Avatar } from "@/app/_components/avatar";

// Social proof for the event page's left rail.
//
// Two separate numbers on purpose. `total` counts everyone — live RSVPs,
// guest RSVPs, and imported historical attendance — while `faces` only ever
// holds members with a discoverable platform profile. On a backfilled event
// that gap is most of the crowd (231 attended, 38 have accounts here), which
// is exactly what the trailing +N tile is for, not a bug to reconcile.
//
// This is a wall, not a stack: at up to 50 faces the overlapping row it used
// to be stops working. Overlap is a negative left margin, and once the row
// wraps that margin lands on the first face of every new line too, pulling it
// out of the left edge. The compact 4-face version on list rows still
// overlaps, because it never wraps.

export type AttendeeFace = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_slug: string | null;
};

// The RPC caps at 50 (20260823100000). Two events on prod have more
// discoverable attendees than that; everyone past the cap folds into +N.
const MAX_VISIBLE = 50;

// Everyone going without a face is one trailing chip, never a tile each.
//
// Tried the other way (eb730cd): one anonymous silhouette per profile-less
// attendee, so 31 going drew 31 circles. It looked like a bug. Twenty-six
// identical grey glyphs read as placeholder state — as if the avatars had
// failed to load — and they buried the four real people at the front of it.
//
// A count is honest about being a count. Faces are for people the viewer can
// actually recognise; the rest is a number, and a number should look like one.

export function AttendeeStack({
  faces,
  total,
  past,
  waitlistedCount,
  waitlistEnabled,
  canViewProfiles,
  nudge = null,
}: {
  faces: AttendeeFace[];
  total: number;
  past: boolean;
  waitlistedCount: number;
  waitlistEnabled: boolean;
  /**
   * Whether this viewer can actually open a member card. Not the same as
   * "is signed in": can_view_member_card() requires the *viewer* to be fully
   * onboarded, so a member who still owes the current privacy policy gets a
   * 404 on every card. Linking anyway is how the stack came to be full of
   * dead ends. Faces stay inert instead.
   */
  canViewProfiles: boolean;
  /**
   * Where a signed-in viewer goes to earn that access, when they can't yet.
   * Inert faces with no explanation are only marginally better than dead
   * links — the viewer still can't tell the difference between "nobody is
   * clickable" and "this page is broken".
   */
  nudge?: { href: string; label: string } | null;
}) {
  if (total === 0) {
    // Only worth saying on an event someone can still act on. A past event
    // with no recorded attendance is a data gap, not a call to action.
    if (past) return null;
    return (
      <p className="text-sm text-muted-foreground">Be the first to RSVP.</p>
    );
  }

  const visible = faces.slice(0, MAX_VISIBLE);
  const remainder = Math.max(0, total - visible.length);
  const verb = past ? "attended" : "are going";


  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tabular-nums text-foreground">
        {total.toLocaleString()} {past ? "went" : "going"}
        {waitlistEnabled && waitlistedCount > 0 ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            · {waitlistedCount.toLocaleString()} waitlisted
          </span>
        ) : null}
      </h2>

      {visible.length > 0 || remainder > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {visible.map((f) => {
            const name = f.display_name?.trim() || "Member";
            const avatar = (
              <Avatar
                src={f.avatar_url}
                name={name}
                className="h-8 w-8 rounded-full"
                textClassName="text-[11px]"
              />
            );

            return (
              <li key={f.user_id}>
                {canViewProfiles && f.profile_slug ? (
                  <Link
                    href={`/members/${f.profile_slug}`}
                    title={name}
                    // Focus ring is not optional just because hover is the
                    // primary affordance — DESIGN.md §9. rounded-full so the
                    // ring traces the avatar rather than boxing it.
                    className="block rounded-full transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {avatar}
                    <span className="sr-only">{name}</span>
                  </Link>
                ) : (
                  <span title={name} className="block rounded-full">
                    {avatar}
                    <span className="sr-only">{name}</span>
                  </span>
                )}
              </li>
            );
          })}

          {remainder > 0 ? (
            <li
              // Last child of the list, so it lands after every face wherever
              // the row happens to wrap.
              //
              // Dashed, and set off by a small gap. Solid-bordered it was just
              // another 32px circle in a line of 32px circles and read as one
              // more person whose avatar had not loaded. The dash says "this
              // one is a tally, not a face" before the digits are even read.
              //
              // The explanation lives on hover rather than in a caption: at
              // 19rem the rail has no room for a sentence, and the chip reads
              // correctly without one.
              title={`${remainder.toLocaleString()} more ${verb} without a Progsu profile`}
              className="ml-1.5 flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 bg-transparent text-[10px] font-semibold tabular-nums text-muted-foreground"
            >
              {/* "+999" for 4,000 people would be a lie, and four digits do
                  not fit in 32px. Round to thousands past the limit. */}
              <span aria-hidden>
                +
                {remainder > 999
                  ? `${Math.floor(remainder / 1000)}k`
                  : remainder.toLocaleString()}
              </span>
              <span className="sr-only">
                and {remainder.toLocaleString()} more {verb} without a Progsu
                profile
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      {!canViewProfiles && nudge && visible.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <Link
            href={nudge.href}
            className="text-primary underline-offset-2 hover:underline"
          >
            {nudge.label}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
