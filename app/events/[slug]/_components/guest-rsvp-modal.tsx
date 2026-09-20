"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { KeyRound, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/app/_components/phone-input";
import { guestRsvpToEvent } from "@/lib/actions/events";
import {
  GUEST_RSVP_TERMS_COPY,
  GUEST_SCHOOL_EMAIL_ERROR,
  isSchoolEmail,
  SMS_CONSENT_FINE_PRINT,
  SMS_CONSENT_HEADLINE,
} from "@/lib/actions/event-schemas";
import { useTheme } from "@/app/_components/theme-shell";
import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";
import { usePreview } from "@/app/onboarding/_components/preview";

type GuestFields = { name: string; email: string; phone: string };

export function GuestRsvpModal({
  eventId,
  capacityReached,
  waitlistEnabled,
  onClose,
  onSuccess,
  forceAccountExists = false,
}: {
  eventId: string;
  capacityReached: boolean;
  waitlistEnabled: boolean;
  onClose: () => void;
  onSuccess: (status: "going" | "waitlisted") => void;
  // /dev/screens only. This state is normally reached by submitting details
  // that match a member, which needs a database.
  forceAccountExists?: boolean;
}) {
  const [fields, setFields] = useState<GuestFields>({
    name: "",
    email: "",
    phone: "",
  });
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [notStudent, setNotStudent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // Set when the submitted email or phone already belongs to a member. The
  // RSVP is NOT recorded in that case — the only way forward is signing in.
  // See docs/16-guest-conversion §3.1.
  const [accountExists, setAccountExists] = useState(forceAccountExists);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const preview = usePreview();
  // ThemeShell owns the .dark class on a wrapper div, not <html> — the
  // portal below renders outside that wrapper entirely, so it has to apply
  // the class itself or the token colors (bg-popover etc.) fall back to
  // light-mode values.
  const { theme } = useTheme();
  // No `next` override: an unonboarded first-time signup is routed straight
  // into /onboarding/verify-email by /auth/callback regardless, and passing
  // the event path here would make isPublicEventDetailPath() honor it
  // instead, bouncing them back to the event and skipping onboarding
  // entirely, the opposite of what this button is for.
  const {
    pending: googlePending,
    error: googleError,
    signIn: signInWithGoogle,
  } = useGoogleSignIn();

  useEffect(() => {
    nameRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const closedNoWaitlist = capacityReached && !waitlistEnabled;
  const submitLabel = capacityReached && waitlistEnabled ? "Join waitlist" : "Register";

  function set<K extends keyof GuestFields>(key: K, value: GuestFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (closedNoWaitlist) return;
    setError(null);
    setFieldError(null);
    // Checked here as well as in the action so a student who typed a Gmail, or
    // fat-fingered "student.edu.gsu", hears about it before the round trip.
    if (!notStudent && !isSchoolEmail(fields.email)) {
      setError(GUEST_SCHOOL_EMAIL_ERROR);
      setFieldError("email");
      return;
    }
    setPending(true);
    // /dev/screens: everything up to here is real — native validation, the
    // SMS box, the pending spinner. Only the RSVP write is skipped.
    if (preview) {
      onSuccess("going");
      preview.advance("/joined");
      return;
    }
    const res = await guestRsvpToEvent({
      eventId,
      name: fields.name.trim(),
      email: fields.email.trim(),
      phone: fields.phone.trim(),
      smsOptIn,
      notStudent,
    });
    if (!res.ok) {
      setPending(false);
      if (res.error.code === "ACCOUNT_EXISTS") {
        setAccountExists(true);
        return;
      }
      setError(res.error.message);
      setFieldError(res.error.field ?? null);
      return;
    }
    const status =
      res.data.effectiveStatus === "waitlisted" ? "waitlisted" : "going";
    onSuccess(status);
    // Deliberately keeps `pending` true: the modal stays in its spinner state
    // until the navigation commits, rather than flashing an idle form.
    router.push(`/joined/${res.data.claimToken}`);
  }

  return createPortal(
    <div
      // Portal straight into <body>: rendered inline in the tree, a
      // position:fixed overlay's containing block can get hijacked by any
      // ancestor with transform/filter/etc, leaving the scrim not actually
      // covering the viewport and real page content showing through
      // undimmed. Rendering outside the tree entirely removes that class of
      // bug regardless of what ancestors do.
      className={`${theme === "dark" ? "dark " : ""}fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="RSVP as a guest"
        // Solid, no backdrop-filter: stacking this on top of the scrim's own
        // backdrop-blur (two nested backdrop-filters) glitches/ghosts in
        // Safari. .glass-blur was built for single-layer surfaces like the
        // sticky header, not a card sitting on an already-blurred scrim.
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-border/60 bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">
            {accountExists ? "You're already a member" : "Your info"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {accountExists ? (
          <div className="flex flex-col items-center gap-3 px-5 pb-8 pt-2 text-center">
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary"
            >
              <KeyRound size={20} strokeWidth={1.75} />
            </span>
            {/* Names the two fields but not which one matched. Withholding
                both left someone who had already tried three fresh emails no
                way to guess their phone number was the match. */}
            <p className="text-sm leading-relaxed text-muted-foreground">
              That email or phone number is already on a Progsu account. Sign
              in and your RSVP takes one tap — plus you keep your ticket and
              attendance history.
            </p>
            {googleError ? (
              <p role="alert" className="text-xs text-destructive">
                {googleError}
              </p>
            ) : null}
            <Button
              type="button"
              onClick={() => signInWithGoogle()}
              disabled={googlePending}
              className="mt-1 h-11 w-full rounded-full text-[15px] shadow-[0_8px_20px_-10px_hsl(var(--primary)/0.55)] transition-[transform,box-shadow,opacity] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-10px_hsl(var(--primary)/0.6)] active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              {googlePending ? (
                <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden />
              ) : null}
              {googlePending ? "Redirecting…" : "Sign in with Google"}
            </Button>
            <button
              type="button"
              onClick={() => setAccountExists(false)}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Use different details
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-5 pb-5">
            <div className="space-y-1.5">
              <Label htmlFor="guest-rsvp-name">Full name *</Label>
              <Input
                id="guest-rsvp-name"
                ref={nameRef}
                required
                autoComplete="name"
                disabled={pending}
                placeholder="Ada Lovelace"
                value={fields.name}
                onChange={(e) => set("name", e.target.value)}
                className="rounded-xl"
                aria-invalid={fieldError === "name"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest-rsvp-email">
                {notStudent ? "Email *" : "School email *"}
              </Label>
              <Input
                id="guest-rsvp-email"
                type="email"
                required
                autoComplete="email"
                disabled={pending}
                placeholder={notStudent ? "you@example.com" : "you@student.gsu.edu"}
                value={fields.email}
                onChange={(e) => set("email", e.target.value)}
                className="rounded-xl"
                aria-describedby="guest-rsvp-email-hint"
                aria-invalid={fieldError === "email"}
              />
              {/* A .edu is required unless the box below is ticked. It is what
                  carries onto the profile and into the lists recruiters get,
                  and asking by label alone let Gmails and typo'd domains
                  through. Alumni, speakers, and sponsors come to these events
                  too, so the way out is one tap, not a closed door. */}
              <p
                id="guest-rsvp-email-hint"
                className="text-[11.5px] leading-[1.4] text-muted-foreground"
              >
                {notStudent
                  ? "Any email works."
                  : "Your .edu address — it\u2019s what gets you into the lists we send recruiters."}
              </p>
              <label className="flex cursor-pointer items-center gap-2 pt-0.5">
                <input
                  type="checkbox"
                  checked={notStudent}
                  disabled={pending}
                  onChange={(e) => {
                    setNotStudent(e.target.checked);
                    if (fieldError === "email") {
                      setError(null);
                      setFieldError(null);
                    }
                  }}
                  className="h-4 w-4 flex-shrink-0 accent-[hsl(var(--primary))]"
                />
                <span className="text-[12px] leading-snug text-muted-foreground">
                  I&apos;m not a student
                </span>
              </label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest-rsvp-phone">Phone number *</Label>
              <PhoneInput
                id="guest-rsvp-phone"
                required
                disabled={pending}
                value={fields.phone}
                onChange={(v) => set("phone", v)}
                invalid={fieldError === "phone"}
              />
            </div>

            {/* Unchecked by default and staying that way. A pre-ticked box is
                not express written consent, and carrier review looks for
                exactly this — so the nudge here is visual, never a default.

                Both strings are cut to fit one line at this modal's 384px
                (see event-schemas.ts). Two lines of headline left an orphaned
                "anytime." and three lines of fine print read as legal sludge,
                which is what people were skipping past.

                The fine print is no longer indented under the headline: that
                28px of padding bought alignment and cost a line of wrapping,
                and full-bleed is the cheaper trade. */}
            <div
              className={
                "rounded-xl border px-3 py-2.5 transition-colors " +
                (smsOptIn
                  ? "border-primary/50 bg-primary/10"
                  : "border-primary/25 bg-primary/[0.04]")
              }
            >
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={smsOptIn}
                  disabled={pending}
                  onChange={(e) => setSmsOptIn(e.target.checked)}
                  className="h-[18px] w-[18px] flex-shrink-0 accent-[hsl(var(--primary))]"
                />
                <span className="text-[13px] font-medium leading-snug text-foreground">
                  {SMS_CONSENT_HEADLINE}
                </span>
              </label>
              <p className="mt-1 text-[10.5px] leading-[1.4] text-muted-foreground">
                {SMS_CONSENT_FINE_PRINT}
              </p>
            </div>

            {error ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </div>
            ) : closedNoWaitlist ? (
              <p className="text-xs text-destructive">
                This event is full and the waitlist is closed.
              </p>
            ) : null}

            {/* bg-foreground/text-background, not bg-white/text-[#151515]:
                this modal follows the page theme, and a hardcoded white pill
                rendered invisible on the light theme (white button on a white
                popover). The token pair gives the same white-on-dark pill in
                dark mode and inverts correctly in light. */}
            <Button
              type="submit"
              disabled={pending || closedNoWaitlist}
              className="h-11 w-full rounded-full bg-foreground text-[15px] text-background hover:bg-foreground/90"
            >
              {pending ? (
                <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden />
              ) : null}
              {pending ? "Registering…" : submitLabel}
            </Button>

            {/* The Terms and Privacy reference the SMS fine print used to
                carry. Still on screen at the moment of consent, which is what
                review cares about — just not crowding the checkbox. */}
            <p className="text-center text-[10.5px] leading-[1.4] text-muted-foreground">
              {GUEST_RSVP_TERMS_COPY.replace(
                "our Terms and Privacy Policy.",
                "our "
              )}
              <a
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Terms
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Privacy Policy
              </a>
              .
            </p>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
