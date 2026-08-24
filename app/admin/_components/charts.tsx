// Chart primitives for the admin surfaces.
//
// No chart library, by decision — docs/13-roadmap/03-admin-analytics.md §5:
// every shape this product needs is a bar, and recharts/nivo/d3 is 40–150 kB
// of JS to draw a rectangle. These are server components made of divs, so
// they cost zero client JS and render in the first paint.
//
// One visual system throughout: bars are `bg-primary` at descending opacity
// steps, never a rainbow of raw palette colors (DESIGN.md §2). Every bar sits
// in a visible track so an empty bucket reads as a real zero instead of
// disappearing — a signup chart with the quiet weeks dropped tells a growth
// story that did not happen.
//
// Accessibility: each chart is one `role="img"` region with a summarising
// label rather than dozens of announced bars. Individual bars carry a
// `title` for pointer users.

const BAR_TRACK = "bg-muted/40";
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

// ---------------------------------------------------------------------------
// Vertical bars over time
// ---------------------------------------------------------------------------

export type ColumnDatum = {
  key: string;
  /** Short axis label. On a long series only the ends and middle render. */
  label: string;
  /** Long label for the hover title, e.g. "Week of Apr 27". */
  title: string;
  value: number;
  /** Optional second line in the hover title, e.g. "4 events". */
  note?: string;
};

export function ColumnChart({
  data,
  ariaLabel,
  height = "h-28",
  unit,
}: {
  data: ColumnDatum[];
  ariaLabel: string;
  height?: string;
  /** Word used in hover titles: "signups", "attendees". */
  unit: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  // Up to a year of monthly buckets, every column can carry its own label.
  // Past that (26 weekly buckets) they collide and get clipped, so the axis
  // collapses to first / middle / last — the three a reader actually needs
  // to place the shape in time.
  const denseAxis = data.length <= 12;

  return (
    <div>
      <div
        role="img"
        aria-label={ariaLabel}
        className={`flex items-end gap-[3px] ${height}`}
      >
        {data.map((d) => (
          <div
            key={d.key}
            title={`${d.title}: ${d.value.toLocaleString()} ${unit}${
              d.note ? ` · ${d.note}` : ""
            }`}
            className={`group/bar relative flex h-full flex-1 items-end overflow-hidden rounded-[3px] ${BAR_TRACK}`}
          >
            <div
              aria-hidden
              className="w-full rounded-[3px] bg-primary/80 transition-[height,background-color] duration-500 group-hover/bar:bg-primary motion-reduce:transition-none"
              style={{
                height: `${pct(d.value, max)}%`,
                transitionTimingFunction: EASE,
                // A real zero still needs a visible foot, or the bar and its
                // track are indistinguishable and the week looks like a gap
                // in the data rather than a week nobody joined.
                minHeight: d.value > 0 ? "3px" : "0",
              }}
            />
          </div>
        ))}
      </div>
      {denseAxis ? (
        <div aria-hidden className="mt-2 flex gap-[3px]">
          {data.map((d) => (
            <div
              key={d.key}
              className="min-w-0 flex-1 truncate text-center text-[10px] leading-none text-muted-foreground"
            >
              {d.label}
            </div>
          ))}
        </div>
      ) : (
        <div
          aria-hidden
          className="mt-2 flex items-baseline justify-between text-[10px] leading-none text-muted-foreground"
        >
          <span>{data[0]?.label}</span>
          <span>{data[Math.floor((data.length - 1) / 2)]?.label}</span>
          <span>{data[data.length - 1]?.label}</span>
        </div>
      )}
    </div>
  );
}

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
