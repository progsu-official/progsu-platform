"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { KeyRound, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guestRsvpToEvent } from "@/lib/actions/events";
import { SMS_CONSENT_COPY } from "@/lib/actions/event-schemas";
import { useTheme } from "@/app/_components/theme-shell";
import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";

type GuestFields = { name: string; email: string; phone: string };

export function GuestRsvpModal({
  eventId,
  capacityReached,
  waitlistEnabled,
  onClose,
  onSuccess,
}: {
  eventId: string;
  capacityReached: boolean;
  waitlistEnabled: boolean;
  onClose: () => void;
  onSuccess: (status: "going" | "waitlisted") => void;
}) {
  const [fields, setFields] = useState<GuestFields>({
    name: "",
    email: "",
    phone: "",
  });
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // Set when the submitted email or phone already belongs to a member. The
  // RSVP is NOT recorded in that case — the only way forward is signing in.
  // See docs/16-guest-conversion §3.1.
  const [accountExists, setAccountExists] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
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
    setPending(true);
    const res = await guestRsvpToEvent({
      eventId,
      name: fields.name.trim(),
      email: fields.email.trim(),
      phone: fields.phone.trim(),
      smsOptIn,
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
              <Label htmlFor="guest-rsvp-email">School email *</Label>
              <Input
                id="guest-rsvp-email"
                type="email"
                required
                autoComplete="email"
                disabled={pending}
                placeholder="you@student.gsu.edu"
                value={fields.email}
                onChange={(e) => set("email", e.target.value)}
                className="rounded-xl"
                aria-describedby="guest-rsvp-email-hint"
                aria-invalid={fieldError === "email"}
              />
              {/* Asked for by name rather than validated to a hard allowlist:
                  a .edu is what carries onto the profile and unlocks recruiter
                  exports, but alumni, speakers, and people from other schools
                  come to these events too, and none of them should be turned
                  away at the door over an address. */}
              <p
                id="guest-rsvp-email-hint"
                className="text-[11.5px] leading-[1.4] text-muted-foreground"
              >
                Use your .edu if you have one — it&apos;s what gets you into the
                lists we send recruiters. Any email works.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest-rsvp-phone">Phone number *</Label>
              <Input
                id="guest-rsvp-phone"
                type="tel"
                required
                autoComplete="tel"
                disabled={pending}
                placeholder="201 555 0123"
                value={fields.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="rounded-xl"
                aria-invalid={fieldError === "phone"}
              />
            </div>

            {/* Unchecked by default and staying that way. A pre-ticked box is
                not express written consent, and carrier review looks for
                exactly this. The disclosure text is the same constant stored
                with the consent record. */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-3">
              <input
                type="checkbox"
                checked={smsOptIn}
                disabled={pending}
                onChange={(e) => setSmsOptIn(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[hsl(var(--primary))]"
              />
              <span className="text-[11.5px] leading-[1.45] text-muted-foreground">
                {SMS_CONSENT_COPY}
              </span>
            </label>

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
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
