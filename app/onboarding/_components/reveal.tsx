"use client";

import { cn } from "@/lib/utils";

// Progressive disclosure for a step's later blocks. Ported from folk-web's
// <Collapse> (components/signup/collapse.tsx): always mounted, so opening is a
// height glide rather than content teleporting in, and `inert` is what keeps
// the closed state out of the tab order.
//
// Used to stop a step showing every question at once. Answer the first block
// and the next one arrives — the screen stays one decision deep no matter how
// many it eventually asks.
export function Reveal({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("onb-reveal", open && "onb-reveal--open", className)}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="onb-reveal-inner">{children}</div>
    </div>
  );
}

// Waterfalls in behind the glide. `index` drives the stagger.
export function CascadeItem({
  index = 0,
  children,
  className,
}: {
  index?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("onb-cascade-item", className)}
      style={{ ["--onb-i" as string]: index }}
    >
      {children}
    </div>
  );
}
