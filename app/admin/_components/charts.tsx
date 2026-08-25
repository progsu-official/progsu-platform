// Static chart primitives for the admin surfaces.
//
// No chart library, by decision — docs/13-roadmap/03-admin-analytics.md §5:
// every shape this product needs is a bar, and recharts/nivo/d3 is 40–150 kB
// of JS to draw a rectangle. Everything here is a server component made of
// divs, so it costs zero client JS and renders in the first paint.
//
// The one exception lives next door: time-series-chart.tsx is a client
// component, because a 26-bucket series is the one shape people point at and
// a tooltip needs state. Distributions and funnels don't — you read a ranked
// list, you don't interrogate it — so they stay here and stay free.
//
// One visual system throughout: bars are `bg-primary` at descending opacity
// steps, never a rainbow of raw palette colors (DESIGN.md §2). Every bar sits
// in a visible track so an empty bucket reads as a real zero instead of
// disappearing — a signup chart with the quiet weeks dropped tells a growth
// story that did not happen.
//
// Accessibility: each chart is one `role="img"` region with a summarising
// label rather than dozens of announced bars.

import { BAR_TRACK, EASE, pct } from "./chart-tokens";

// ---------------------------------------------------------------------------
// Horizontal bars for a distribution
// ---------------------------------------------------------------------------

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  /** Right-hand annotation, e.g. "70%" or a date. */
  hint?: string;
};

export function BarList({
  data,
  ariaLabel,
  /** Scale bars against this instead of the largest row (use a total for a
   *  share-of-members read, omit for a rank read). */
  max: maxOverride,
  tone = "primary",
}: {
  data: BarDatum[];
  ariaLabel: string;
  max?: number;
  tone?: "primary" | "stepped";
}) {
  const max = maxOverride ?? Math.max(1, ...data.map((d) => d.value));

  return (
    <ul role="img" aria-label={ariaLabel} className="space-y-2.5">
      {data.map((d, i) => (
        <li key={d.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground">{d.label}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium text-foreground">
                {d.value.toLocaleString()}
              </span>
              {d.hint ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {d.hint}
                </span>
              ) : null}
            </span>
          </div>
          <div
            className={`mt-1.5 h-1.5 w-full overflow-hidden rounded-full ${BAR_TRACK}`}
          >
            <div
              aria-hidden
              className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
              style={{
                width: `${pct(d.value, max)}%`,
                transitionTimingFunction: EASE,
                // "stepped" fades each row down the list so a ranked chart
                // reads top-to-bottom without needing a second hue.
                opacity: tone === "stepped" ? Math.max(0.35, 1 - i * 0.11) : 1,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Funnel — the same bars, but every step is a share of step one
// ---------------------------------------------------------------------------

export function Funnel({
  steps,
  ariaLabel,
}: {
  steps: Array<{ key: string; label: string; value: number; note?: string }>;
  ariaLabel: string;
}) {
  const top = Math.max(1, steps[0]?.value ?? 1);

  return (
    <ol role="img" aria-label={ariaLabel} className="space-y-3">
      {steps.map((s, i) => {
        const share = Math.round((s.value / top) * 100);
        return (
          <li key={s.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-foreground">
                {s.label}
              </span>
              <span className="shrink-0 text-sm tabular-nums">
                <span className="font-semibold text-foreground">
                  {s.value.toLocaleString()}
                </span>
                {i > 0 ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {share}%
                  </span>
                ) : null}
              </span>
            </div>
            <div
              className={`mt-1.5 h-2 w-full overflow-hidden rounded-full ${BAR_TRACK}`}
            >
              <div
                aria-hidden
                className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                style={{
                  width: `${pct(s.value, top)}%`,
                  transitionTimingFunction: EASE,
                  opacity: Math.max(0.4, 1 - i * 0.14),
                }}
              />
            </div>
            {s.note ? (
              <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Card shell — one surface family for every panel on the dashboard
// ---------------------------------------------------------------------------

export function Panel({
  title,
  hint,
  action,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-border/70 bg-card p-5 ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h2>
          {hint ? (
            <p className="mt-1 text-sm text-foreground/90">{hint}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
