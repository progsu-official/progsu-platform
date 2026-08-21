"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

import { Popover } from "./_composer/_components/popover";

// A native <select>'s option list is entirely browser-drawn — no control
// over size, position, or text scale, and it visibly opened detached from
// the trigger instead of anchored below it. This is the same Popover the
// composer's pickers use, just recolored to admin's light card surface
// instead of the composer's dark purple.
export function StatusFilterSelect({
  tabs,
  active,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
}) {
  const router = useRouter();
  const activeLabel = tabs.find((t) => t.key === active)?.label ?? active;

  return (
    <Popover
      panelClassName="w-52 border-border/70 bg-card"
      trigger={({ ref, props, open }) => (
        <button
          ref={ref}
          type="button"
          {...props}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-sm text-foreground transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            open && "border-primary/50"
          )}
        >
          {activeLabel}
          <ChevronDown
            size={15}
            strokeWidth={1.75}
            aria-hidden
            className={cn(
              "text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      )}
    >
      {(close) => (
        <div className="py-1.5">
          {tabs.map((t) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  close();
                  router.push(`/admin/events?tab=${t.key}`);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60",
                  isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <Check
                  size={14}
                  strokeWidth={2.5}
                  aria-hidden
                  className={cn(
                    "shrink-0 text-primary",
                    !isActive && "opacity-0"
                  )}
                />
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
