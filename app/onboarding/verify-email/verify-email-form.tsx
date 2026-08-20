"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestStudentEmailCode,
  reserveStudentEmail,
  verifyStudentEmailCode,
} from "@/lib/actions/verification";
import type { ActionResult } from "@/lib/actions/result";

import {
  OnbActionBar,
  OnbErrorBox,
  OnbPrimaryButton,
  OnbSeam,
  OnbSurface,
  onbInputFocusClasses,
  useOnbSeam,
} from "../_components/shell";

type Phase = "email" | "code";

// "Verify later" is deliberately not shown the instant the page loads — we want
// users to actually attempt the OTP first. But it has to become reachable no
// matter what, or a failed send (school not on the allowlist, rate limit) leaves
// them with no way out of onboarding. Revealed at the earliest of these.
const SEND_REVEAL_MS = 15_000;
const MOUNT_REVEAL_MS = 30_000;

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

// Per-mode error copy: settings keeps the app's sentence case; the onboarding
// branch speaks the funnel's lowercase voice and points at the actual
// lowercase "verify later" control it renders.
const ERROR_COPY_SETTINGS: Record<string, string> = {
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

const ERROR_COPY_ONBOARDING: Record<string, string> = {
  UNAUTHORIZED: "please sign in again.",
  DOMAIN_NOT_ALLOWED:
    "we can't send a code to that school yet — it's not on our allowlist. click \"verify later\" to save your email and we'll let you know when we add it.",
  EMAIL_TAKEN:
    "that email is already in use on another progsu account. contact an admin if this is a mistake.",
  RATE_LIMITED: "please wait before requesting another code.",
  OTP_INVALID: "incorrect code.",
  OTP_EXPIRED: "that code expired. send yourself a new one.",
  OTP_LOCKED: "too many attempts. request a new code later.",
  CONFLICT: "you're already verified. sign out and back in if this looks wrong.",
  INVALID_INPUT: "please check the input and try again.",
  INTERNAL: "something went wrong. please try again.",
};

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Quiet tertiary control, folk's "use a different number" treatment on progsu
// tokens. Used only by the onboarding branch below.
const quietButtonClass =
  "text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm disabled:pointer-events-none disabled:opacity-60";

// Reusable across onboarding (/onboarding/verify-email) and settings
// (/profile/settings/account-email-settings). Mode controls post-success
// behavior AND the skin:
//   - "onboarding" → folk shell skin (OnbSurface/OnbActionBar/seam);
//     router.push(skipDestination); router.refresh().
//   - "settings"   → the original shadcn inline layout, untouched — that page
//     is outside the onboarding design language; calls onSuccess; caller
//     collapses inline UI + refreshes.
// allowSkip toggles the "Verify later" reserveStudentEmail path. Settings
// is past onboarding so always passes false.
export type VerifyEmailFormMode = "onboarding" | "settings";

export function VerifyEmailForm({
  initialEmail,
  fullyOnboarded,
  mode = "onboarding",
  allowSkip = true,
  intro,
  onSuccess,
  onCancel,
}: {
  initialEmail: string;
  fullyOnboarded: boolean;
  mode?: VerifyEmailFormMode;
  allowSkip?: boolean;
  // Server-rendered <OnbIntro> passed down so the onboarding branch can keep
  // it inside ONE OnbSurface with the phase content (single reveal stagger)
  // while OnbActionBar stays a sibling of the surface, per the shell contract.
  intro?: ReactNode;
  onSuccess?: (result: { studentEmail: string; verifiedAt: string }) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const skipDestination = fullyOnboarded ? "/profile" : "/onboarding/profile";
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
  // successful requestStudentEmailCode.
  const [sendRevealAt, setSendRevealAt] = useState<number | null>(null);
  const [mountRevealAt] = useState(() => Date.now() + MOUNT_REVEAL_MS);
  // Some errors tell the user in so many words to click "Verify later" — don't
  // make them wait out a timer to find the button the message points at.
  const [errorForcedReveal, setErrorForcedReveal] = useState(false);
  const [pending, startTransition] = useTransition();
  // Seam choreography for the email ↔ code swap. Onboarding branch only; in
  // settings mode phase commits run immediately, exactly as before.
  const { seam, run: runSeam } = useOnbSeam();
  const now = useNow(500);
  const skipRevealed =
    errorForcedReveal ||
    now >= mountRevealAt ||
    (sendRevealAt != null && now >= sendRevealAt);

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
    const copy =
      mode === "settings" ? ERROR_COPY_SETTINGS : ERROR_COPY_ONBOARDING;
    const base =
      copy[code] ??
      result.error.message ??
      (mode === "settings" ? "Something went wrong." : "something went wrong.");
    if (code === "DOMAIN_NOT_ALLOWED" || code === "RATE_LIMITED") {
      setErrorForcedReveal(true);
    }
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

  // Same commit as ever; the seam only delays WHEN it lands (~190ms exit) in
  // onboarding mode so the phase swap gets folk's exit-then-enter grammar.
  function commitPhase(commit: () => void, dir: "fwd" | "back") {
    if (mode === "onboarding") runSeam(commit, dir);
    else commit();
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
      commitPhase(() => {
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
        setSendRevealAt((prev) => prev ?? Date.now() + SEND_REVEAL_MS);
      }, "fwd");
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
    commitPhase(() => {
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
    }, "back");
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

  if (mode === "settings") {
    // The original pre-folk layout, verbatim — /profile/settings embeds this
    // form inside its own card and speaks the app's shadcn language, not the
    // onboarding shell's.
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
              {onCancel ? (
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

  // ── onboarding skin ─────────────────────────────────────────────
  // One OnbSurface (intro + seam-wrapped phase content), OnbActionBar as its
  // SIBLING (the reveal animates transform/filter, which would trap the bar's
  // position:fixed). The bar's submit pill targets whichever <form> the
  // current phase rendered, via the form attribute.
  const resendLabel =
    msUntilResend > 0
      ? `resend in ${Math.ceil(msUntilResend / 1000)}s`
      : "send a new code";

  return (
    <>
      <OnbSurface>
        {intro}
        <OnbSeam seam={seam} className="mt-6">
          {state.phase === "email" ? (
            <form id="onb-verify-email-request" onSubmit={onRequest}>
              <label htmlFor="student-email" className="sr-only">
                student email
              </label>
              <input
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
                // 16px+ floor: iOS Safari auto-zooms sub-16px inputs, and this
                // shell is overflow-hidden so the zoom can't be scrolled back.
                className={`h-14 w-full rounded-[14px] border border-border bg-card px-5 text-center text-[17px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-60 ${onbInputFocusClasses}`}
              />
              {state.errorField === "studentEmail" && state.errorMessage ? (
                <p id="email-error" role="alert" className="mt-3 text-center text-sm text-destructive">
                  {state.errorMessage}
                </p>
              ) : null}
              <p className="mx-auto mt-4 max-w-md text-center text-xs text-muted-foreground">
                optional — but recruiters only see verified members.
              </p>
              {skipRevealed && allowSkip ? (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={onSkip}
                    disabled={pending || state.email.length === 0}
                    className={quietButtonClass}
                  >
                    didn&apos;t get a code? verify later
                  </button>
                </div>
              ) : null}
            </form>
          ) : (
            <form id="onb-verify-email-code" onSubmit={onVerify}>
              <p className="text-center text-[13.5px] leading-[1.5] text-muted-foreground">
                we sent a code to{" "}
                <span className="font-medium text-foreground">{state.email}</span>
                {" — it expires in "}
                <span className="tabular-nums">{expiryLabel}</span>.
              </p>
              {/* Segmented code cells (Cosmos-style): six discrete boxes, one
                  glyph each. The REAL input still exists — stretched invisibly
                  over the row — so focus, typing, paste, iOS one-time-code
                  autofill, and every aria attribute behave exactly as before;
                  the cells are a pure projection of its value. The cell after
                  the last typed digit lights up while the input has focus. */}
              <div className="group relative mx-auto mt-5 w-fit">
                <label htmlFor="otp-code" className="sr-only">
                  6-digit code
                </label>
                <div aria-hidden className="flex items-center gap-2">
                  {Array.from({ length: 6 }, (_, i) => {
                    const char = state.code[i] ?? "";
                    const isNext = i === Math.min(state.code.length, 5);
                    return (
                      <span
                        key={i}
                        className={`flex h-14 w-11 items-center justify-center rounded-[14px] border bg-card text-[22px] font-semibold tabular-nums text-foreground shadow-sm transition-[border-color,box-shadow] sm:w-12 ${
                          state.errorField === "code"
                            ? "border-destructive/60"
                            : char
                              ? "border-foreground/25"
                              : "border-border"
                        } ${
                          isNext
                            ? "group-focus-within:border-primary group-focus-within:ring-2 group-focus-within:ring-primary/25"
                            : ""
                        }`}
                      >
                        {char}
                      </span>
                    );
                  })}
                </div>
                <input
                  id="otp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="\d{6}"
                  required
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
                  className="absolute inset-0 h-full w-full cursor-text opacity-0 disabled:cursor-not-allowed"
                />
              </div>
              {state.errorField === "code" && state.errorMessage ? (
                <p id="code-error" role="alert" className="mt-3 text-center text-sm text-destructive">
                  {state.errorMessage}
                  {typeof state.attemptsRemaining === "number" &&
                  state.attemptsRemaining > 0 ? (
                    <> ({state.attemptsRemaining} attempt
                      {state.attemptsRemaining === 1 ? "" : "s"} left)</>
                  ) : null}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                <button
                  type="button"
                  onClick={onResend}
                  disabled={pending || msUntilResend > 0}
                  aria-live="polite"
                  className={`${quietButtonClass} tabular-nums`}
                >
                  {resendLabel}
                </button>
                <button
                  type="button"
                  onClick={onChangeEmail}
                  disabled={pending}
                  className={quietButtonClass}
                >
                  use a different email
                </button>
                {skipRevealed && allowSkip ? (
                  <button
                    type="button"
                    onClick={onSkip}
                    disabled={pending}
                    className={quietButtonClass}
                  >
                    verify later
                  </button>
                ) : null}
              </div>
            </form>
          )}

          {state.errorMessage && !state.errorField ? (
            <OnbErrorBox className="mt-4 text-center">
              {state.errorMessage}
            </OnbErrorBox>
          ) : null}
        </OnbSeam>
      </OnbSurface>

      <OnbActionBar>
        {state.phase === "email" ? (
          <OnbPrimaryButton
            type="submit"
            form="onb-verify-email-request"
            loading={pending}
            disabled={state.email.length === 0}
          >
            send the code
          </OnbPrimaryButton>
        ) : (
          <OnbPrimaryButton
            type="submit"
            form="onb-verify-email-code"
            loading={pending}
            disabled={state.code.length !== 6 || msUntilExpiry === 0}
          >
            verify
          </OnbPrimaryButton>
        )}
      </OnbActionBar>

      <div ref={liveRef} aria-live="polite" className="sr-only" />
    </>
  );
}
