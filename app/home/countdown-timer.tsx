"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";

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
// server-rendered markup has no numbers to mismatch against on hydration.
// A live second-by-second clock computed on the server would already be
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
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">
          Countdown to {label}
        </p>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-500">
          <Zap size={12} strokeWidth={2.5} aria-hidden />
          slots are limited, sign up now!
        </p>
      </div>
      <div className="flex items-baseline gap-2.5 sm:gap-5">
        {units.map((u, i) => (
          <div key={u.unit} className="flex items-baseline gap-2.5 sm:gap-5">
            <div className="flex flex-col items-center">
              <span className="text-5xl font-black tabular-nums tracking-tight text-foreground dark:text-white sm:text-7xl">
                {String(u.value).padStart(2, "0")}
              </span>
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
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
    </div>
  );
}
