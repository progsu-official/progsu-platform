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

function Segment({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-3xl font-black tabular-nums text-white sm:text-5xl">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50 sm:text-xs">
        {label}
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
    <div className="flex items-center gap-2 sm:gap-3">
      <Segment value={parts.days} label="days" />
      <span className="text-3xl font-black text-primary sm:text-5xl">:</span>
      <Segment value={parts.hours} label="hrs" />
      <span className="text-3xl font-black text-primary sm:text-5xl">:</span>
      <Segment value={parts.minutes} label="min" />
      <span className="text-3xl font-black text-primary sm:text-5xl">:</span>
      <Segment value={parts.seconds} label="sec" />
    </div>
  );
}
