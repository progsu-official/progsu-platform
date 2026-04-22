"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { rsvpToEvent } from "@/lib/actions/events";

type CurrentRsvp = {
  status: "going" | "waitlisted" | "declined" | "cancelled" | null;
  waitlistPosition: number | null;
};

export function RsvpPanel({
  eventId,
  initial,
  rsvpOpen,
  capacity,
  goingCount,
  waitlistEnabled,
  waitlistedCount,
}: {
  eventId: string;
  initial: CurrentRsvp;
  rsvpOpen: boolean;
  capacity: number | null;
  goingCount: number;
  waitlistEnabled: boolean;
  waitlistedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState<CurrentRsvp>(initial);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const capacityReached = capacity !== null && goingCount >= capacity;

  function submit(desired: "going" | "declined" | "cancelled") {
    setError(null);
    startTransition(async () => {
      const res = await rsvpToEvent(eventId, desired, comment.trim() || undefined);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setCurrent({
        status: res.data.effectiveStatus,
        // Fresh waitlist entries: server re-render will fetch the real
        // position. Clear here so we don't show stale numbers.
        waitlistPosition:
          res.data.effectiveStatus === "waitlisted" ? null : null,
      });
      // Refresh the server component so capacity counts + the rest of the
      // page update to match the new state.
      router.refresh();
    });
  }

  if (!rsvpOpen) {
    return (
      <section className="rounded-md border p-4 text-sm">
        <p className="text-muted-foreground">
          RSVPs are closed for this event.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Your RSVP</h2>
          <CurrentStateLine current={current} />
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}

      {current.status === null ? (
        <NoRsvpForm
          onGoing={() => submit("going")}
          onDeclined={() => submit("declined")}
          pending={pending}
          comment={comment}
          setComment={setComment}
          capacityReached={capacityReached}
          waitlistEnabled={waitlistEnabled}
        />
      ) : current.status === "going" ? (
        <ActionButtons
          pending={pending}
          buttons={[
            {
              label: "Change to Declined",
              onClick: () => submit("declined"),
              variant: "outline",
            },
            {
              label: "Cancel RSVP",
              onClick: () => submit("cancelled"),
              variant: "ghost",
            },
          ]}
        />
      ) : current.status === "waitlisted" ? (
        <ActionButtons
          pending={pending}
          buttons={[
            {
              label: "Leave waitlist",
              onClick: () => submit("cancelled"),
              variant: "outline",
            },
          ]}
        />
      ) : (
        <ActionButtons
          pending={pending}
          buttons={[
            {
              label: capacityReached && waitlistEnabled
                ? "Join waitlist"
                : "RSVP as Going",
              onClick: () => submit("going"),
              variant: "default",
            },
          ]}
        />
      )}

      {waitlistEnabled && current.status !== "waitlisted" ? (
        <p className="text-[11px] text-muted-foreground">
          Waitlist: {waitlistedCount} waiting.
        </p>
      ) : null}
    </section>
  );
}

function CurrentStateLine({ current }: { current: CurrentRsvp }) {
  if (current.status === null) {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        You haven&apos;t responded yet.
      </p>
    );
  }
  if (current.status === "going") {
    return <p className="mt-0.5 text-xs text-primary">You&apos;re going.</p>;
  }
  if (current.status === "waitlisted") {
    return (
      <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
        You&apos;re on the waitlist
        {current.waitlistPosition != null
          ? ` — you're #${current.waitlistPosition}.`
          : "."}
      </p>
    );
  }
  if (current.status === "declined") {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">You declined.</p>
    );
  }
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      You cancelled your RSVP.
    </p>
  );
}

function NoRsvpForm({
  onGoing,
  onDeclined,
  pending,
  comment,
  setComment,
  capacityReached,
  waitlistEnabled,
}: {
  onGoing: () => void;
  onDeclined: () => void;
  pending: boolean;
  comment: string;
  setComment: (v: string) => void;
  capacityReached: boolean;
  waitlistEnabled: boolean;
}) {
  const goingLabel =
    capacityReached && waitlistEnabled ? "Join waitlist" : "I'm going";
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          Comment (optional)
        </span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={2}
          disabled={pending}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Questions for the hosts? Share them here."
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onGoing} disabled={pending}>
          {pending ? "Saving…" : goingLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDeclined}
          disabled={pending}
        >
          {pending ? "Saving…" : "Not going"}
        </Button>
      </div>
      {capacityReached && !waitlistEnabled ? (
        <p className="text-[11px] text-destructive">
          This event is full.
        </p>
      ) : null}
    </div>
  );
}

type ActionButton = {
  label: string;
  onClick: () => void;
  variant: "default" | "outline" | "ghost";
};

function ActionButtons({
  pending,
  buttons,
}: {
  pending: boolean;
  buttons: ActionButton[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((b) => (
        <Button
          key={b.label}
          type="button"
          variant={b.variant}
          onClick={b.onClick}
          disabled={pending}
        >
          {pending ? "Saving…" : b.label}
        </Button>
      ))}
    </div>
  );
}
