"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type RenderTrigger = (state: {
  open: boolean;
  toggle: () => void;
  ref: React.Ref<HTMLButtonElement>;
  props: {
    "aria-expanded": boolean;
    "aria-haspopup": "dialog";
    "aria-controls": string;
    onClick: () => void;
  };
}) => React.ReactNode;

/**
 * Anchored popover. Deliberately not a headless-UI dependency: the composer
 * needs three visually different panels off the same behaviour (escape,
 * outside click, focus return) and nothing more.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  panelClassName,
  className,
}: {
  trigger: RenderTrigger;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  panelClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      {trigger({
        open,
        toggle,
        ref: triggerRef,
        props: {
          "aria-expanded": open,
          "aria-haspopup": "dialog",
          "aria-controls": panelId,
          onClick: toggle,
        },
      })}
      {open ? (
        <div
          id={panelId}
          role="dialog"
          className={cn(
            "absolute z-50 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#1C1620] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]",
            "animate-fade-up",
            align === "end" ? "right-0" : "left-0",
            panelClassName
          )}
        >
          {children(() => {
            setOpen(false);
            triggerRef.current?.focus();
          })}
        </div>
      ) : null}
    </div>
  );
}
