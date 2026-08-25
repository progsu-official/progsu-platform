// Shared between charts.tsx (server components) and time-series-chart.tsx
// (client). Split out so the one interactive chart can import the visual
// constants without pulling the whole server-component module across the
// "use client" boundary, and so a track colour or easing curve can't drift
// between the static charts and the interactive one.

/** Every bar sits in a visible track so an empty bucket reads as a real zero
 *  rather than disappearing. See DESIGN.md §10. */
export const BAR_TRACK = "bg-muted/40";

/** DESIGN.md §1.8 — exponential ease-out, the one easing curve in the app. */
export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
