"use client";

import { useEffect, useState } from "react";

function diffParts(targetMs: number, nowMs: number) {
  const totalSeconds = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

// Number/label sizes and weights match the date plate's day number and
// month label (hero-carousel.tsx) so the two chips read as one family
// instead of the timer looking like a separate, louder component.
function Segment({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl font-black tabular-nums tracking-tight text-white sm:text-2xl">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/60 sm:text-[11px]">
        {label}
      </span>
    </div>
  );
}

// Matches Segment's two-row height (number + label) with an invisible
// second row, so items-start lines the colon glyph up with the numbers
// above their labels instead of centering across the taller two-row block.
function Colon() {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl font-black text-white sm:text-2xl">:</span>
      <span aria-hidden className="invisible text-[9px] sm:text-[11px]">
        :
      </span>
    </div>
  );
}

// Digital-clock style countdown: big numbers, small labels, colons between.
// Seeded from the server-rendered target on first render so there's no
// hydration flash of "00:00:00:00" before the first tick.
export function CountdownTimer({ target }: { target: string }) {
  const targetMs = new Date(target).getTime();
  const [parts, setParts] = useState(() => diffParts(targetMs, Date.now()));

  useEffect(() => {
    const id = setInterval(() => setParts(diffParts(targetMs, Date.now())), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  return (
    <div className="flex items-start gap-1.5 sm:gap-2">
      <Segment value={parts.days} label="days" />
      <Colon />
      <Segment value={parts.hours} label="hrs" />
      <Colon />
      <Segment value={parts.minutes} label="min" />
      <Colon />
      <Segment value={parts.seconds} label="sec" />
    </div>
  );
}
