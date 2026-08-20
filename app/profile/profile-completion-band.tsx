import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { ProfileCompletion } from "@/lib/auth/profile-completion";

// Profile-completion band (docs/14-low-friction-signup §3). Server-rendered.
//
// Sits full-width above the events row rather than in the sidebar: a complete
// profile is the thing that decides whether recruiters ever see this member, so
// it outranks everything it used to sit beside. Kept to a single row — it's a
// standing nudge on every dashboard visit, and a tall one would read as a
// banner to dismiss rather than a task to finish.

const RING_SIZE = 56;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

// Enough to fill the width without wrapping the row on a laptop.
const MAX_CHIPS = 3;

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];

function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function ProfileCompletionBand({
  completion,
}: {
  completion: ProfileCompletion;
}) {
  const { slots, completed, total, recruiterEligible } = completion;
  const unfinished = slots.filter((s) => !s.done);

  if (completed === total) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-primary/30 bg-primary/10 px-5 py-3.5">
        <div>
          <p className="text-sm font-medium text-foreground">
            You&apos;re all set
          </p>
          <p className="text-xs text-muted-foreground">
            Recruiters and event hosts can see your full profile.
          </p>
        </div>
        <Link
          href="/profile/settings"
          className="rounded-md text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Manage
        </Link>
      </section>
    );
  }

  const [next, ...rest] = unfinished;
  const chips = rest.slice(0, MAX_CHIPS);
  const overflow = rest.length - chips.length;
  const pct = total === 0 ? 0 : completed / total;
  const dashOffset = RING_CIRC * (1 - pct);

  // Speaks to the member, not about the system, and adapts to how much is
  // actually left — "one more step" when it's one, a count when it isn't. The
  // count moved in here from the subline the ring was already showing.
  // Still no invented statistics: we don't measure outreach, so we don't claim
  // a number on it.
  const headline = recruiterEligible
    ? "You're set for recruiters. These extras make you stand out."
    : unfinished.length === 1
      ? "One more step and recruiters can find you"
      : `${countWord(unfinished.length)} steps left before recruiters can find you`;

  return (
    <section className="flex flex-col gap-4 rounded-2xl glass px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="shrink-0"
        role="img"
        aria-label={`${completed} of ${total} profile items completed`}
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRC}
          strokeDashoffset={dashOffset}
          className="text-primary"
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground text-[11px] font-semibold tabular-nums"
        >
          {completed}/{total}
        </text>
      </svg>

      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold leading-snug text-foreground">
          {headline}
        </h2>
      </div>

      {/* Secondary steps only appear where there's width for them; below lg the
          single primary action carries the band on its own. */}
      {chips.length > 0 ? (
        <ul className="hidden shrink-0 items-center gap-1.5 lg:flex">
          {chips.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className="inline-flex items-center rounded-full border border-border/80 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {s.label}
              </Link>
            </li>
          ))}
          {overflow > 0 ? (
            <li>
              <Link
                href="/profile/settings"
                className="inline-flex items-center rounded-full px-2 py-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                +{overflow} more
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}

      {next ? (
        <Button
          asChild
          size="sm"
          className="shrink-0 rounded-full sm:w-auto"
        >
          <Link href={next.href}>{next.label}</Link>
        </Button>
      ) : null}
    </section>
  );
}
