"use client";

import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2E1240]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-violet-500" : "bg-white/15"
      )}
    >
      {/* left-0 is load-bearing: without it the knob resolves to its static
          position, which the button's centered text-align puts mid-track, and
          the translate then carries it off the end. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
