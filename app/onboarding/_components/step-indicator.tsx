"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { OnboardingStep } from "@/lib/auth/onboarding";

// Verify-email is intentionally NOT in the cascade — users can complete the
// funnel without it, then come back to verify when their OTP actually arrives.
// See lib/auth/onboarding.ts for the fullyOnboarded rule.
const STEPS: Array<{ key: OnboardingStep; label: string; path: string }> = [
  { key: "profile", label: "Profile", path: "/onboarding/profile" },
  { key: "resume", label: "Resume", path: "/onboarding/resume" },
  { key: "consent", label: "Consent", path: "/onboarding/consent" },
];

export function StepIndicator({ nextStep }: { nextStep: OnboardingStep }) {
  const pathname = usePathname();
  const nextIdx = nextStep === null ? STEPS.length : STEPS.findIndex((s) => s.key === nextStep);

  return (
    <ol
      className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
      aria-label="Onboarding progress"
    >
      {STEPS.map((s, i) => {
        const isDone = i < nextIdx;
        const isActive = pathname.startsWith(s.path);
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-[10px]",
                isDone && "border-primary bg-primary text-primary-foreground",
                isActive && !isDone && "border-primary text-primary",
                !isDone && !isActive && "border-muted-foreground/30"
              )}
              aria-current={isActive ? "step" : undefined}
            >
              {isDone ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                isActive && "text-foreground",
                isDone && "text-foreground"
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "mx-1 h-px w-6",
                  isDone ? "bg-primary" : "bg-muted-foreground/30"
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
