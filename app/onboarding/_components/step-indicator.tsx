"use client";

import { usePathname } from "next/navigation";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OnboardingStep } from "@/lib/auth/onboarding";

// Verify-email is not in the onboarding CASCADE — the funnel completes without
// it and people come back when the code actually arrives (see
// lib/auth/onboarding.ts). It is still the first screen anyone sees after
// OAuth, so leaving it out of the bar meant your first impression was a
// progress meter reading zero while you were already doing work. It is shown
// here as a step and simply never blocks.
const STEPS: Array<{ key: OnboardingStep | "verify"; label: string; path: string }> = [
  { key: "verify", label: "verify email", path: "/onboarding/verify-email" },
  { key: "profile", label: "the basics", path: "/onboarding/profile" },
  { key: "links", label: "what you're into", path: "/onboarding/links" },
  { key: "resume", label: "resume", path: "/onboarding/resume" },
  { key: "consent", label: "consent", path: "/onboarding/consent" },
];

// Sits in the header rather than above the form. Three dashes and a label:
// enough to answer "how much is left" without turning progress into the
// loudest thing on a page whose actual job is one question.
export function StepIndicator({ nextStep }: { nextStep: OnboardingStep }) {
  const pathname = usePathname() ?? "";
  // "verify" never appears as nextStep, so a null nextStep means done and
  // anything else resolves by key; the verify pill leads and is treated as
  // complete once the cascade has moved past it.
  const nextIdx =
    nextStep === null ? STEPS.length : STEPS.findIndex((s) => s.key === nextStep);
  const activeIdx = STEPS.findIndex((s) => pathname.startsWith(s.path));
  const current = activeIdx >= 0 ? STEPS[activeIdx] : null;

  return (
    <div className="flex items-center gap-3">
      <ol className="flex items-center gap-1.5" aria-label="Onboarding progress">
        {STEPS.map((s, i) => {
          const isDone = i < nextIdx;
          const isActive = i === activeIdx;
          return (
            <li key={s.key}>
              <span
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "block h-1 rounded-full transition-all duration-300 motion-reduce:transition-none",
                  isActive ? "w-6 bg-primary" : "w-4",
                  !isActive && isDone && "bg-primary/40",
                  !isActive && !isDone && "bg-foreground/10"
                )}
              >
                <span className="sr-only">
                  {s.label}
                  {isDone ? " (done)" : isActive ? " (current)" : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        {current ? (
          <>
            <span className="tabular-nums">
              {Math.min(activeIdx + 1, STEPS.length)}
            </span>
            <span aria-hidden> / </span>
            <span className="tabular-nums">{STEPS.length}</span>
            <span className="ml-1.5">{current.label}</span>
          </>
        ) : nextStep === null ? (
          // "done" is a claim about the CASCADE, not about which page is
          // open. On /onboarding/verify-email — a soft step outside the
          // dashes — a fresh account used to fall through to this branch and
          // get told it was done before answering a single question.
          <span className="inline-flex items-center gap-1.5">
            <Check size={13} strokeWidth={2.25} aria-hidden className="text-primary" />
            done
          </span>
        ) : null}
      </p>
    </div>
  );
}
