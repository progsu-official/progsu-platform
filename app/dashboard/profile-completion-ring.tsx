import Link from "next/link";

import type { ProfileCompletion } from "@/lib/auth/profile-completion";

// Profile-completion ring (docs/14-low-friction-signup §3). Server-rendered.
// Collapses to a tiny badge when complete; otherwise shows the ring + top 2
// unfinished nudges with a "See all" expander.

const RING_SIZE = 72;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

export function ProfileCompletionRing({
  completion,
}: {
  completion: ProfileCompletion;
}) {
  const { slots, completed, total, recruiterEligible } = completion;
  const unfinished = slots.filter((s) => !s.done);
  const topUnfinished = unfinished.slice(0, 2);
  const remaining = unfinished.length - topUnfinished.length;

  if (completed === total) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <div>
          <p className="font-medium text-foreground">Profile complete</p>
          <p className="text-xs text-muted-foreground">
            You&apos;re visible to recruiters and event hosts.
          </p>
        </div>
        <Link
          href="/dashboard/settings?tab=profile"
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Manage
        </Link>
      </section>
    );
  }

  const pct = total === 0 ? 0 : completed / total;
  const dashOffset = RING_CIRC * (1 - pct);

  return (
    <section className="flex items-start gap-4 rounded-md border bg-background p-4">
      <Link
        href="/dashboard/settings?tab=profile"
        className="shrink-0"
        aria-label={`Profile ${completed} of ${total} complete. Open profile settings.`}
      >
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          role="img"
          aria-hidden
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
            className="fill-foreground text-sm font-semibold tabular-nums"
          >
            {completed}/{total}
          </text>
        </svg>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {recruiterEligible
              ? "Add links to stand out to recruiters"
              : "Complete your profile"}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {recruiterEligible
              ? "You're recruiter-visible"
              : "Not yet recruiter-visible"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {recruiterEligible
            ? "Optional extras that make your card harder to ignore."
            : "Recruiters only see members with a complete profile."}
        </p>
        <ul className="mt-3 space-y-1.5">
          {topUnfinished.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                {s.label} &rarr;
              </Link>
            </li>
          ))}
        </ul>
        {remaining > 0 ? (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              See all ({remaining} more)
            </summary>
            <ul className="mt-2 space-y-1.5">
              {unfinished.slice(2).map((s) => (
                <li key={s.key}>
                  <Link
                    href={s.href}
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {s.label} &rarr;
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
