"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestStudentEmailCode,
  reserveStudentEmail,
  verifyStudentEmailCode,
} from "@/lib/actions/verification";
import type { ActionResult } from "@/lib/actions/result";

type Phase = "email" | "code";

type FormState = {
  phase: Phase;
  email: string;
  code: string;
  expiresAt: number | null; // epoch ms
  attemptsRemaining: number | null;
  retryAfterMs: number | null; // cooldown until resend allowed
  retryAnchor: number | null; // epoch ms anchor for cooldown countdown
  errorMessage: string | null;
  errorField: "studentEmail" | "code" | null;
};

const ERROR_COPY: Record<string, string> = {
  UNAUTHORIZED: "Please sign in again.",
  DOMAIN_NOT_ALLOWED:
    "We can't send a code to that school yet — it's not on our allowlist. Click \"Verify later\" to save your email and we'll let you know when we add it.",
  EMAIL_TAKEN:
    "That email is already in use on another Progsu account. Contact an admin if this is a mistake.",
  RATE_LIMITED: "Please wait before requesting another code.",
  OTP_INVALID: "Incorrect code.",
  OTP_EXPIRED: "That code expired. Send yourself a new one.",
  OTP_LOCKED: "Too many attempts. Request a new code later.",
  CONFLICT: "You're already verified. Sign out and back in if this looks wrong.",
  INVALID_INPUT: "Please check the input and try again.",
  INTERNAL: "Something went wrong. Please try again.",
};

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Reusable across onboarding (/onboarding/verify-email) and settings
// (/dashboard/settings#account-email). Mode controls post-success behavior:
//   - "onboarding" → router.push(skipDestination); router.refresh().
//   - "settings"   → calls onSuccess; caller collapses inline UI + refreshes.
// allowSkip toggles the "Verify later" reserveStudentEmail path. Settings
// is past onboarding so always passes false.
export type VerifyEmailFormMode = "onboarding" | "settings";

export function VerifyEmailForm({
  initialEmail,
  fullyOnboarded,
  mode = "onboarding",
  allowSkip = true,
  onSuccess,
  onCancel,
}: {
  initialEmail: string;
  fullyOnboarded: boolean;
  mode?: VerifyEmailFormMode;
  allowSkip?: boolean;
  onSuccess?: (result: { studentEmail: string; verifiedAt: string }) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const skipDestination = fullyOnboarded ? "/dashboard" : "/onboarding/profile";
  const [state, setState] = useState<FormState>({
    phase: initialEmail ? "email" : "email",
    email: initialEmail,
    code: "",
    expiresAt: null,
    attemptsRemaining: null,
    retryAfterMs: null,
    retryAnchor: null,
    errorMessage: null,
    errorField: null,
  });
  // Anchor timestamp for the "didn't receive a code?" reveal delay. Set on first
  // successful requestStudentEmailCode; the button only appears 15s after.
  const [skipRevealAt, setSkipRevealAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const now = useNow(500);
  const skipRevealed = skipRevealAt != null && now >= skipRevealAt;

  // Message live-region for aria-live announcements
  const liveRef = useRef<HTMLDivElement>(null);

  const msUntilExpiry =
    state.expiresAt != null ? Math.max(0, state.expiresAt - now) : 0;
  const msUntilResend =
    state.retryAfterMs != null && state.retryAnchor != null
      ? Math.max(0, state.retryAfterMs - (now - state.retryAnchor))
      : 0;

  function setError(result: Extract<ActionResult<unknown>, { ok: false }>) {
    const code = result.error.code;
    const base = ERROR_COPY[code] ?? result.error.message ?? "Something went wrong.";
    setState((s) => ({
      ...s,
      errorMessage: base,
      errorField:
        result.error.field === "studentEmail"
          ? "studentEmail"
          : result.error.field === "code"
            ? "code"
            : null,
      attemptsRemaining:
        typeof result.error.attemptsRemaining === "number"
          ? result.error.attemptsRemaining
          : s.attemptsRemaining,
      retryAfterMs:
        typeof result.error.retryAfterMs === "number"
          ? result.error.retryAfterMs
          : s.retryAfterMs,
      retryAnchor:
        typeof result.error.retryAfterMs === "number"
          ? Date.now()
          : s.retryAnchor,
    }));
    queueMicrotask(() => liveRef.current?.setAttribute("data-updated", String(Date.now())));
  }

  function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setState((s) => ({ ...s, errorMessage: null, errorField: null }));
    startTransition(async () => {
      const result = await requestStudentEmailCode({ studentEmail: state.email });
      if (!result.ok) {
        setError(result);
        return;
      }
      const expiresAt = new Date(result.data.expiresAt).getTime();
      setState((s) => ({
        ...s,
        phase: "code",
        expiresAt,
        code: "",
        attemptsRemaining: null,
        errorMessage: null,
        errorField: null,
        retryAfterMs: 60_000,
        retryAnchor: Date.now(),
      }));
      // Only start the "didn't receive?" reveal timer on first send, so users
      // can't trick the UI by click-resending immediately.
      setSkipRevealAt((prev) => prev ?? Date.now() + 15_000);
    });
  }

  function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setState((s) => ({ ...s, errorMessage: null, errorField: null }));
    startTransition(async () => {
      const result = await verifyStudentEmailCode({
        studentEmail: state.email,
        code: state.code.trim(),
      });
      if (!result.ok) {
        setError(result);
        return;
      }
      if (mode === "settings") {
        onSuccess?.(result.data);
        router.refresh();
        return;
      }
      router.push(skipDestination);
      router.refresh();
    });
  }

  function onResend() {
    setState((s) => ({ ...s, errorMessage: null, errorField: null }));
    startTransition(async () => {
      const result = await requestStudentEmailCode({ studentEmail: state.email });
      if (!result.ok) {
        setError(result);
        return;
      }
      const expiresAt2 = new Date(result.data.expiresAt).getTime();
      setState((s) => ({
        ...s,
        expiresAt: expiresAt2,
        attemptsRemaining: null,
        retryAfterMs: 60_000,
        retryAnchor: Date.now(),
      }));
    });
  }

  function onChangeEmail() {
    setState((s) => ({
      ...s,
      phase: "email",
      code: "",
      expiresAt: null,
      attemptsRemaining: null,
      retryAfterMs: null,
      retryAnchor: null,
      errorMessage: null,
      errorField: null,
    }));
  }

  function onSkip() {
    setState((s) => ({ ...s, errorMessage: null, errorField: null }));
    startTransition(async () => {
      const result = await reserveStudentEmail({ studentEmail: state.email });
      if (!result.ok) {
        setError(result);
        return;
      }
      router.push(skipDestination);
      router.refresh();
    });
  }

  const expiryLabel =
    msUntilExpiry > 0
      ? `${Math.floor(msUntilExpiry / 60000)}:${String(
          Math.floor((msUntilExpiry % 60000) / 1000)
        ).padStart(2, "0")}`
      : "0:00";
  const resendLabel =
    msUntilResend > 0
      ? `Resend in ${Math.ceil(msUntilResend / 1000)}s`
      : "Send a new code";

  return (
    <div className="space-y-6">
      {state.phase === "email" ? (
        <form onSubmit={onRequest} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="student-email">Student email</Label>
            <Input
              id="student-email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@student.gsu.edu"
              value={state.email}
              onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))}
              aria-invalid={state.errorField === "studentEmail"}
              aria-describedby={state.errorField === "studentEmail" ? "email-error" : undefined}
              disabled={pending}
            />
            {state.errorField === "studentEmail" && state.errorMessage ? (
              <p id="email-error" role="alert" className="text-sm text-destructive">
                {state.errorMessage}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" disabled={pending || state.email.length === 0} size="lg">
              {pending ? "Sending…" : "Send verification code"}
            </Button>
            {skipRevealed && allowSkip ? (
              <Button
                type="button"
                variant="link"
                onClick={onSkip}
                disabled={pending || state.email.length === 0}
              >
                Didn&apos;t receive a code? Verify later
              </Button>
            ) : null}
            {mode === "settings" && onCancel ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={pending}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          {mode === "onboarding" ? (
            <p className="text-xs text-muted-foreground">
              You can finish your profile without verifying, but your profile
              won&apos;t be shared with recruiters until you do.
            </p>
          ) : null}
        </form>
      ) : (
        <form onSubmit={onVerify} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We emailed a code to <span className="font-medium text-foreground">{state.email}</span>.
            Expires in <span className="tabular-nums">{expiryLabel}</span>.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="otp-code">6-digit code</Label>
            <Input
              id="otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
              placeholder="000000"
              value={state.code}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  code: e.target.value.replace(/[^\d]/g, "").slice(0, 6),
                }))
              }
              aria-invalid={state.errorField === "code"}
              aria-describedby={state.errorField === "code" ? "code-error" : undefined}
              disabled={pending || msUntilExpiry === 0}
              className="font-mono text-center text-lg tracking-[0.4em]"
            />
            {state.errorField === "code" && state.errorMessage ? (
              <p id="code-error" role="alert" className="text-sm text-destructive">
                {state.errorMessage}
                {typeof state.attemptsRemaining === "number" &&
                state.attemptsRemaining > 0 ? (
                  <> ({state.attemptsRemaining} attempt
                    {state.attemptsRemaining === 1 ? "" : "s"} left)</>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              type="submit"
              size="lg"
              disabled={pending || state.code.length !== 6 || msUntilExpiry === 0}
            >
              {pending ? "Verifying…" : "Verify"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onResend}
              disabled={pending || msUntilResend > 0}
              aria-live="polite"
            >
              {resendLabel}
            </Button>
            <Button type="button" variant="link" onClick={onChangeEmail} disabled={pending}>
              Use a different email
            </Button>
            {skipRevealed && allowSkip ? (
              <Button
                type="button"
                variant="link"
                onClick={onSkip}
                disabled={pending}
              >
                Verify later
              </Button>
            ) : null}
          </div>
        </form>
      )}

      {state.errorMessage && !state.errorField ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.errorMessage}
        </div>
      ) : null}
      <div ref={liveRef} aria-live="polite" className="sr-only" />
    </div>
  );
}
