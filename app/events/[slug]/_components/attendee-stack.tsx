import Link from "next/link";
import { User } from "lucide-react";

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

// Everyone else going who has no face to show — almost entirely guests, who
// RSVP with a name and email and never create a profile. On the kickoff event
// that is 26 of the 31 going, and rendering them as a single "+27" chip made a
// full room look like four people and a rounding error.
//
// They render as anonymous tiles: a person glyph, no name, no initial. Guests
// were promised in privacy v6 that they "do not appear on the public attendee
// list", and an initial is still an appearance. A countable silhouette is not
// — it says how many, which the "31 going" heading already said out loud.
//
// Upcoming events only. Social proof is a reason to RSVP, and a past event
// does not need one; more to the point the imported legacy events carry 200-400
// profile-less attendees each, and a wall of identical blanks under a 2025
// tournament is noise, not proof.
const MAX_ANONYMOUS = 40;

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

  const anonymous = past ? 0 : Math.min(remainder, MAX_ANONYMOUS);
  const overflow = remainder - anonymous;

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

          {Array.from({ length: anonymous }, (_, i) => (
            <li
              key={`anon-${i}`}
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
            >
              <User className="h-4 w-4" strokeWidth={1.75} />
            </li>
          ))}
          {anonymous > 0 ? (
            <li className="sr-only">
              and {anonymous.toLocaleString()} more {verb} without a Progsu
              profile
            </li>
          ) : null}

          {overflow > 0 ? (
            <li
              // The explanation lives on hover rather than in a caption: at
              // 19rem the rail has no room for a sentence, and the tile reads
              // correctly without one.
              title={`${overflow.toLocaleString()} more ${verb} without a Progsu profile`}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground"
            >
              {/* "+999" for 4,000 people would be a lie, and four digits do
                  not fit in 32px. Round to thousands past the limit. */}
              <span aria-hidden>
                +
                {overflow > 999
                  ? `${Math.floor(overflow / 1000)}k`
                  : overflow.toLocaleString()}
              </span>
              <span className="sr-only">
                and {overflow.toLocaleString()} more {verb} without a Progsu
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
