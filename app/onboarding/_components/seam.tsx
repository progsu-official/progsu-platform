"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export type OnbSeamDir = "fwd" | "back";

export type OnbSeamState = {
  phase: "exit" | "enter";
  dir: OnbSeamDir;
} | null;

/**
 * Seam choreography for view swaps inside a step (ported from folk's
 * useOnboardingSeam). `run(commit, dir)` plays the ~190ms exit, commits the
 * state change, then plays the enter. Reduced motion commits instantly. A
 * second navigation arriving mid-transition flushes the pending commit first
 * so no swap is dropped.
 */
export function useOnbSeam(): {
  seam: OnbSeamState;
  run: (commit: () => void, dir?: OnbSeamDir) => void;
} {
  const [seam, setSeam] = useState<OnbSeamState>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const run = useCallback((commit: () => void, dir: OnbSeamDir = "fwd") => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
      pending.current?.();
      pending.current = null;
    }
    if (reduced) {
      setSeam(null);
      commit();
      return;
    }
    setSeam({ phase: "exit", dir });
    pending.current = commit;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      pending.current = null;
      commit();
      setSeam({ phase: "enter", dir });
    }, 190);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return { seam, run };
}

/**
 * Wrapper that wears the seam classes for the current phase. Animates `left`
 * on position:relative (never transform), so a fixed OnbActionBar inside is
 * not re-anchored. Classes are defined in ../onboarding.css under `.onb`.
 */
export function OnbSeam({
  seam,
  className,
  children,
}: {
  seam: OnbSeamState;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "onboarding-seam",
        seam && `onboarding-seam-${seam.phase}-${seam.dir}`,
        className,
      )}
    >
      {children}
    </div>
  );
}
