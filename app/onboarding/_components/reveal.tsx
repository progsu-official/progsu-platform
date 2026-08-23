"use client";

import { useEffect, useRef } from "react";

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
  const ref = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(open);

  // Answering the last field of a block reveals the next one BELOW the fold,
  // so without this the reward for finishing is a screen that looks unchanged.
  // Waits out the 450ms glide first: scrolling to a box that is still growing
  // lands short of where it ends up.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const t = setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 480);
      wasOpen.current = true;
      return () => clearTimeout(t);
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <div
      ref={ref}
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
