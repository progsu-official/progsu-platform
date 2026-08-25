"use client";

import { useId, useState } from "react";
import { ChartColumn, ChartLine } from "lucide-react";

import { BAR_TRACK, EASE, pct } from "./chart-tokens";

// The one interactive chart in the admin surface.
//
// Everything else in charts.tsx is a server component made of divs, which is
// the right trade for a shape nobody points at. A time series is the exception:
// on 26 weekly buckets the question is always "which week was that spike", and
// the native `title` attribute this used to rely on answers it badly — a
// second of delay, no styling, and nothing at all on touch. So this one file
// buys a tooltip and a bar/line toggle with a small amount of client JS.
//
// Still no chart library. The line is a hand-rolled polyline over the same
// scale the bars use, so toggling views changes the shape's form and never
// its story.
//
// Accessibility: one role="img" with a summarising label, as the static charts
// do — announcing 26 buckets one at a time is worse than one good sentence.
// The plot is focusable, and arrow keys step through buckets into a live
// region, so the per-bucket numbers the tooltip shows are reachable without a
// pointer. That readout only exists once someone has focused the chart and
// pressed a key, so it never fires for a reader just passing through.

export type ColumnDatum = {
  key: string;
  /** Short axis label. On a long series only the ends and middle render. */
  label: string;
  /** Long label for the tooltip, e.g. "Week of Apr 27". */
  title: string;
  value: number;
  /** Optional second line in the tooltip, e.g. "4 events". */
  note?: string;
};

type View = "bars" | "line";

export function TimeSeriesChart({
  data,
  ariaLabel,
  unit,
  height = "h-28",
  label,
  hint,
}: {
  data: ColumnDatum[];
  ariaLabel: string;
  /** Word used in the tooltip and the keyboard readout: "signups". */
  unit: string;
  height?: string;
  /** Optional heading rendered left of the toggle. Omit inside a Panel, which
   *  already carries the title. */
  label?: string;
  /** Optional right-aligned note, e.g. "Last 26 weeks". */
  hint?: string;
}) {
  const [view, setView] = useState<View>("bars");
  const [active, setActive] = useState<number | null>(null);
  // Tracks how `active` was set. A pointer hover must not push text into the
  // live region — the sighted user can already see the tooltip, and a screen
  // reader following a mouse it isn't driving is noise.
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const gradientId = useId();

  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.value));
  // Up to a year of monthly buckets, every column can carry its own label.
  // Past that (26 weekly buckets) they collide and get clipped, so the axis
  // collapses to first / middle / last — the three a reader needs to place
  // the shape in time.
  const denseAxis = n <= 12;

  const point = (i: number) => ({
    x: n <= 1 ? 50 : (i / (n - 1)) * 100,
    y: 100 - pct(data[i].value, max),
  });

  const activeDatum = active === null ? null : data[active];

  function describe(d: ColumnDatum): string {
    return `${d.title}: ${d.value.toLocaleString()} ${unit}${
      d.note ? `, ${d.note}` : ""
    }`;
  }

  function step(delta: number) {
    if (n === 0) return;
    setViaKeyboard(true);
    setActive((prev) => {
      if (prev === null) return delta > 0 ? 0 : n - 1;
      return Math.max(0, Math.min(n - 1, prev + delta));
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") return step(1), e.preventDefault();
    if (e.key === "ArrowLeft") return step(-1), e.preventDefault();
    if (e.key === "Home") {
      setViaKeyboard(true);
      setActive(0);
      return e.preventDefault();
    }
    if (e.key === "End") {
      setViaKeyboard(true);
      setActive(n - 1);
      return e.preventDefault();
    }
    if (e.key === "Escape") setActive(null);
  }

  return (
    <div>
      {label || hint ? (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {label ? (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </h2>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {hint ? (
              <p className="text-xs text-muted-foreground">{hint}</p>
            ) : null}
            <ViewToggle view={view} onChange={setView} />
          </div>
        </div>
      ) : (
        <div className="mb-2 flex justify-end">
          <ViewToggle view={view} onChange={setView} />
        </div>
      )}

      <div
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => {
          if (!viaKeyboard) setActive(null);
        }}
        className={`relative text-primary outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-primary/60 rounded-[3px] ${height}`}
      >
        {view === "bars" ? (
          <div className="flex h-full items-end gap-[3px]">
            {data.map((d, i) => (
              <div
                key={d.key}
                className={`relative flex h-full flex-1 items-end overflow-hidden rounded-[3px] ${BAR_TRACK}`}
              >
                <div
                  aria-hidden
                  className="w-full rounded-[3px] transition-[height,background-color] duration-500 motion-reduce:transition-none"
                  style={{
                    height: `${pct(d.value, max)}%`,
                    transitionTimingFunction: EASE,
                    backgroundColor: "currentColor",
                    opacity: active === null || active === i ? 1 : 0.45,
                    // A real zero still needs a visible foot, or the bar and
                    // its track are indistinguishable and the week looks like
                    // a gap in the data rather than a week nobody joined.
                    minHeight: d.value > 0 ? "3px" : "0",
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className={`relative h-full overflow-hidden rounded-[3px] ${BAR_TRACK}`}>
            <svg
              aria-hidden
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              // The plot is a fixed-height box of arbitrary width, so the
              // viewBox has to stretch. non-scaling-stroke keeps the line an
              // even 2px through that distortion; the dot is an HTML element
              // for the same reason, since a circle here would render as an
              // ellipse.
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              {n > 0 ? (
                <>
                  <path
                    fill={`url(#${gradientId})`}
                    d={`M ${point(0).x},100 ${data
                      .map((_, i) => {
                        const p = point(i);
                        return `L ${p.x},${p.y}`;
                      })
                      .join(" ")} L ${point(n - 1).x},100 Z`}
                  />
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    points={data
                      .map((_, i) => {
                        const p = point(i);
                        return `${p.x},${p.y}`;
                      })
                      .join(" ")}
                  />
                </>
              ) : null}
            </svg>

            {active !== null ? (
              <>
                <div
                  aria-hidden
                  className="absolute top-0 bottom-0 w-px bg-primary/40"
                  style={{ left: `${point(active).x}%` }}
                />
                <div
                  aria-hidden
                  className="absolute h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
                  style={{
                    left: `${point(active).x}%`,
                    top: `${point(active).y}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              </>
            ) : null}
          </div>
        )}

        {/* One hit target per bucket, sized identically in both views so the
            tooltip lands on the same week whichever form is showing. */}
        <div aria-hidden className="absolute inset-0 flex">
          {data.map((d, i) => (
            <div
              key={d.key}
              className="h-full flex-1"
              onPointerEnter={() => {
                setViaKeyboard(false);
                setActive(i);
              }}
              onPointerDown={() => {
                setViaKeyboard(false);
                setActive(i);
              }}
            />
          ))}
        </div>

        {activeDatum ? (
          <Tooltip
            datum={activeDatum}
            unit={unit}
            x={point(active as number).x}
            edge={
              (active as number) <= 1
                ? "start"
                : (active as number) >= n - 2
                  ? "end"
                  : "center"
            }
          />
        ) : null}
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
          <span>{data[Math.floor((n - 1) / 2)]?.label}</span>
          <span>{data[n - 1]?.label}</span>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {viaKeyboard && activeDatum ? describe(activeDatum) : ""}
      </p>
    </div>
  );
}

function Tooltip({
  datum,
  unit,
  x,
  edge,
}: {
  datum: ColumnDatum;
  unit: string;
  x: number;
  edge: "start" | "center" | "end";
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-lg border border-border/70 bg-popover px-2.5 py-1.5 shadow-lg"
      style={{
        left: `${x}%`,
        // Near the edges a centred tooltip would hang off the plot and get
        // clipped by the panel, so the anchor swings to the near corner
        // instead of the midpoint.
        transform:
          edge === "start"
            ? "translateX(-8%)"
            : edge === "end"
              ? "translateX(-92%)"
              : "translateX(-50%)",
      }}
    >
      <p className="text-[11px] leading-tight text-muted-foreground">
        {datum.title}
      </p>
      <p className="text-sm font-semibold leading-tight tabular-nums text-foreground">
        {datum.value.toLocaleString()}{" "}
        <span className="font-normal text-muted-foreground">{unit}</span>
      </p>
      {datum.note ? (
        <p className="text-[11px] leading-tight text-muted-foreground">
          {datum.note}
        </p>
      ) : null}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
      {(
        [
          { key: "bars", label: "Bar view", Icon: ChartColumn },
          { key: "line", label: "Line view", Icon: ChartLine },
        ] as const
      ).map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={label}
          aria-label={label}
          aria-pressed={view === key}
          className={
            "rounded-[6px] p-1 transition-colors " +
            (view === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          <Icon size={14} strokeWidth={1.75} aria-hidden />
        </button>
      ))}
    </div>
  );
}
