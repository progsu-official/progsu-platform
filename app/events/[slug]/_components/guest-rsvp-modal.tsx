"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guestRsvpToEvent } from "@/lib/actions/events";
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<"going" | "waitlisted" | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
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
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      setFieldError(res.error.field ?? null);
      return;
    }
    const status =
      res.data.effectiveStatus === "waitlisted" ? "waitlisted" : "going";
    setResult(status);
    onSuccess(status);
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
            {result ? "You're in" : "Your info"}
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

        {result ? (
          <div className="flex flex-col items-center gap-3 px-5 pb-8 pt-2 text-center">
            <div className="[perspective:600px]">
              <CheckCircle2
                size={44}
                strokeWidth={1.5}
                className="animate-coin-flip text-primary motion-reduce:animate-none"
                aria-hidden
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {result === "going"
                ? "You're registered. We'll email you the details."
                : "You're on the waitlist. We'll email you if a spot opens."}
            </p>

            <div className="mt-1 w-full space-y-4 rounded-2xl glass p-4 text-left">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
                >
                  <Sparkles size={16} strokeWidth={1.75} />
                </span>
                <p className="text-sm leading-relaxed text-foreground">
                  While you&apos;re here, want to get onboarded? A full
                  member profile is what gets you on recruiters&apos; radar.
                </p>
              </div>
              {googleError ? (
                <p role="alert" className="text-xs text-destructive">
                  {googleError}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  disabled={googlePending}
                  className="h-10 flex-1 rounded-full text-sm text-muted-foreground hover:text-foreground"
                >
                  Maybe later
                </Button>
                <Button
                  type="button"
                  onClick={() => signInWithGoogle()}
                  disabled={googlePending}
                  // Same premium-CTA recipe as onboarding/_components/shell.tsx's
                  // primaryClasses: violet pill that lifts on hover with a
                  // deeper glow, settles back on press. Gives the affirmative
                  // action more visual weight than the plain "Maybe later" ghost.
                  className="h-10 flex-1 rounded-full text-sm shadow-[0_8px_20px_-10px_hsl(var(--primary)/0.55)] transition-[transform,box-shadow,opacity] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-10px_hsl(var(--primary)/0.6)] active:translate-y-0 active:shadow-[0_8px_20px_-10px_hsl(var(--primary)/0.55)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  {googlePending ? (
                    <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden />
                  ) : null}
                  {googlePending ? "Redirecting…" : "Yes, let's go"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-5 pb-5">
            <div className="space-y-1.5">
              <Label htmlFor="guest-rsvp-name">Name *</Label>
              <Input
                id="guest-rsvp-name"
                ref={nameRef}
                required
                disabled={pending}
                value={fields.name}
                onChange={(e) => set("name", e.target.value)}
                className="rounded-xl"
                aria-invalid={fieldError === "name"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest-rsvp-email">Email *</Label>
              <Input
                id="guest-rsvp-email"
                type="email"
                required
                disabled={pending}
                value={fields.email}
                onChange={(e) => set("email", e.target.value)}
                className="rounded-xl"
                aria-invalid={fieldError === "email"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest-rsvp-phone">Phone number *</Label>
              <Input
                id="guest-rsvp-phone"
                type="tel"
                required
                disabled={pending}
                placeholder="201 555 0123"
                value={fields.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="rounded-xl"
                aria-invalid={fieldError === "phone"}
              />
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
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
