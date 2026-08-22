"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guestRsvpToEvent } from "@/lib/actions/events";
import { useTheme } from "@/app/_components/theme-shell";

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
            <CheckCircle2
              size={44}
              strokeWidth={1.5}
              className="text-primary"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">
              {result === "going"
                ? "You're registered. We'll email you the details."
                : "You're on the waitlist. We'll email you if a spot opens."}
            </p>
            <Button
              type="button"
              onClick={onClose}
              className="mt-2 h-10 rounded-full px-8 text-sm"
            >
              Done
            </Button>
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
