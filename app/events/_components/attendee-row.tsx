// Compact attendee stack for a list row — the same social proof the event
// detail page shows in its left rail (app/events/[slug]/_components/
// attendee-stack.tsx), sized down to sit in a card footer.
//
// The two numbers are separate on purpose, exactly as they are on the detail
// page: `total` counts everyone (live RSVPs, guests, imported historical
// attendance) while `faces` only ever holds members with a discoverable
// platform profile. On a backfilled event that gap is most of the crowd —
// "231 went" with four faces is the correct shape, not a bug.

import { Avatar } from "@/app/_components/avatar";
import type { AttendeeFace } from "@/lib/events/attendee-faces";

const MAX_VISIBLE = 4;

export function AttendeeRow({
  faces,
  total,
  label,
  capacity,
  waitlisted,
}: {
  faces: AttendeeFace[];
  total: number;
  /** "going" on an upcoming event, "went" on a past one. */
  label: "going" | "went";
  capacity?: number | null;
  waitlisted?: number;
}) {
  const visible = faces.slice(0, MAX_VISIBLE);
  const countText =
    capacity != null
      ? `${total.toLocaleString()} of ${capacity.toLocaleString()} ${label}`
      : `${total.toLocaleString()} ${label}`;
  const showWaitlist =
    capacity != null && total >= capacity && (waitlisted ?? 0) > 0;

  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {visible.length > 0 ? (
        // ring-background, not a border: overlapping circles need the page
        // colour punched between them or the stack reads as one blurred mass
        // at this size.
        <span className="flex shrink-0 items-center -space-x-1.5">
          {visible.map((f) => (
            <Avatar
              key={f.user_id}
              src={f.avatar_url}
              name={f.display_name?.trim() || "Member"}
              className="h-6 w-6 rounded-full ring-2 ring-background"
              textClassName="text-[9px]"
            />
          ))}
        </span>
      ) : null}
      <span className="tabular-nums text-muted-foreground">
        {countText}
        {showWaitlist ? ` · ${waitlisted!.toLocaleString()} waitlisted` : null}
      </span>
    </span>
  );
}
