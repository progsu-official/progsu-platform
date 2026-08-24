"use client";

import { useEffect, useState } from "react";

function getRemaining(targetMs: number) {
  const diff = Math.max(0, targetMs - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    done: diff <= 0,
  };
}

// Ticks client-side only (useEffect, not useState's initializer) so the
// server-rendered markup has no numbers to mismatch against on hydration —
// a live second-by-second clock, computed on the server, would already be
// stale by the time it reaches the browser.
export function CountdownTimer({
  startsAt,
  label,
}: {
  startsAt: string;
  label: string;
}) {
  const targetMs = new Date(startsAt).getTime();
  const [remaining, setRemaining] = useState<ReturnType<typeof getRemaining> | null>(null);

  useEffect(() => {
    setRemaining(getRemaining(targetMs));
    const id = setInterval(() => setRemaining(getRemaining(targetMs)), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  if (!remaining || remaining.done) return null;

  const units = [
    { value: remaining.days, unit: "days" },
    { value: remaining.hours, unit: "hrs" },
    { value: remaining.minutes, unit: "min" },
    { value: remaining.seconds, unit: "sec" },
  ];

  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Countdown to {label}
      </p>
      <div className="flex items-baseline gap-2.5 sm:gap-5">
        {units.map((u, i) => (
          <div key={u.unit} className="flex items-baseline gap-2.5 sm:gap-5">
            <div className="flex flex-col items-center">
              <span className="font-mono text-4xl font-black tabular-nums tracking-tight text-foreground sm:text-6xl">
                {String(u.value).padStart(2, "0")}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {u.unit}
              </span>
            </div>
            {i < units.length - 1 ? (
              <span className="pb-3 text-2xl font-black text-primary/30 sm:pb-5 sm:text-4xl">
                :
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-sm font-semibold text-amber-500">
        Slots are limited, sign up now!
      </p>
    </div>
  );
}
