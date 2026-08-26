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

// Ticking countdown, spelled out ("44 days 18 hrs 45 min 40 secs") instead
// of a bare DD:HH:MM:SS. Seeded from the server-rendered target on first
// render so there's no hydration flash of "0 days 0 hrs..." before the
// first tick.
export function CountdownTimer({ target }: { target: string }) {
  const targetMs = new Date(target).getTime();
  const [parts, setParts] = useState(() => diffParts(targetMs, Date.now()));

  useEffect(() => {
    const id = setInterval(() => setParts(diffParts(targetMs, Date.now())), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  return (
    <span className="font-black tracking-wide text-primary tabular-nums sm:text-lg">
      {parts.days} days {parts.hours} hrs {parts.minutes} min {parts.seconds} secs
    </span>
  );
}
