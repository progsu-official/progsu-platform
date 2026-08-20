"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** One line of the Event options card. The control lives on the right. */
export function OptionRow({
  icon: Icon,
  label,
  hint,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3.5",
        "border-b border-white/10 last:border-b-0",
        className
      )}
    >
      <Icon
        size={18}
        strokeWidth={1.75}
        aria-hidden
        className="shrink-0 text-white/60"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] text-white">{label}</p>
        {hint ? (
          <p className="truncate text-xs text-white/45">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
