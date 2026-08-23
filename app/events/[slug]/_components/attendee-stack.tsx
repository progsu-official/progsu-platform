import Link from "next/link";

import { Avatar } from "@/app/_components/avatar";

// Social proof for the event page's left rail.
//
// Two separate numbers on purpose. `total` counts everyone — live RSVPs,
// guest RSVPs, and imported historical attendance — while `faces` only ever
// holds members with a discoverable platform profile. On a backfilled event
// that gap is most of the crowd (231 attended, 8 have accounts here), which
// is exactly the "and N others" shape, not a bug to reconcile.

export type AttendeeFace = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_slug: string | null;
};

const MAX_VISIBLE = 5;

function namesCaption(names: string[], total: number): string | null {
  if (names.length === 0) return null;

  const shown = names.slice(0, 2);
  const others = total - shown.length;

  if (others <= 0) {
    return shown.length === 1 ? shown[0] : `${shown[0]} and ${shown[1]}`;
  }
  return `${shown.join(", ")} and ${others.toLocaleString()} other${
    others === 1 ? "" : "s"
  }`;
}

export function AttendeeStack({
  faces,
  total,
  past,
  waitlistedCount,
  waitlistEnabled,
  linkProfiles,
}: {
  faces: AttendeeFace[];
  total: number;
  past: boolean;
  waitlistedCount: number;
  waitlistEnabled: boolean;
  linkProfiles: boolean;
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
  const names = faces
    .map((f) => f.display_name?.trim())
    .filter((n): n is string => !!n);
  const caption = namesCaption(names, total);

  return (
    <section className="space-y-2.5">
      <h2 className="text-sm font-semibold tabular-nums text-foreground">
        {total.toLocaleString()} {past ? "went" : "going"}
        {waitlistEnabled && waitlistedCount > 0 ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            · {waitlistedCount.toLocaleString()} waitlisted
          </span>
        ) : null}
      </h2>

      {visible.length > 0 ? (
        <div className="flex items-center -space-x-2">
          {visible.map((f) => {
            const name = f.display_name?.trim() || "Member";
            // ring-background, not a border: overlapping circles need the
            // page colour punched between them or the stack reads as one
            // blurred mass at this size.
            const avatar = (
              <Avatar
                src={f.avatar_url}
                name={name}
                className="h-8 w-8 rounded-full ring-2 ring-background"
              />
            );

            return linkProfiles && f.profile_slug ? (
              <Link
                key={f.user_id}
                href={`/members/${f.profile_slug}`}
                title={name}
                className="rounded-full transition-transform hover:z-10 hover:-translate-y-0.5"
              >
                {avatar}
              </Link>
            ) : (
              <span key={f.user_id} title={name} className="rounded-full">
                {avatar}
              </span>
            );
          })}
        </div>
      ) : null}

      {caption ? (
        <p className="text-xs text-muted-foreground">{caption}</p>
      ) : null}
    </section>
  );
}
