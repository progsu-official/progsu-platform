"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import {
  OnbActionBar,
  OnbErrorBox,
  OnbIntro,
  OnbPrimaryButton,
  OnbSection,
  OnbSurface,
} from "@/app/onboarding/_components/shell";
import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";
import { stageGuestClaim } from "@/lib/actions/guest-claim";
import { usePreview } from "@/app/onboarding/_components/preview";
import type { GuestClaimContext } from "@/lib/actions/events";

// Two beats, one decision.
//
// This page has been cut down twice. It started as three profile questions,
// then became a single screen that still explained itself three times over —
// a checklist of what was on file, a paragraph about recruiter exports, and an
// SMS box already ticked on the form before it. All of that was answering
// questions nobody had stopped to ask.
//
// What is left is the shape of the moment itself: land the confirmation, let
// it settle, then ask the one thing worth asking. The reasons live on the
// screens that follow, where someone has already said yes.

const HOLD_MS = 1500;
const FADE_MS = 400;

export function WelcomeFlow({
  token,
  context,
  devBypass = false,
  freeze,
}: {
  token: string;
  context: GuestClaimContext;
  // Holds one beat instead of running the timed sequence. Only /dev/screens
  // passes it: the live page auto-advances after 1.5s, which makes the first
  // beat impossible to actually look at.
  freeze?: "landed" | "ask";
  // Local development: swap the Google redirect for /api/dev-login, which
  // mints a blank test account and runs the SAME claim RPC off the SAME
  // cookie. Only the identity provider is faked.
  devBypass?: boolean;
}) {
  const [phase, setPhase] = useState<"landed" | "leaving" | "ask">(
    freeze ?? "landed"
  );
  const [pending, startPending] = useTransition();
  const { pending: googlePending, error: googleError, signIn } = useGoogleSignIn();
  const preview = usePreview();

  // Hold the confirmation long enough to read, fade it, then swap. The timers
  // run under reduced motion too — the transition is decoration, the sequence
  // is content, and skipping it would drop the confirmation entirely.
  useEffect(() => {
    if (freeze) return;
    const toLeaving = setTimeout(() => setPhase("leaving"), HOLD_MS);
    const toAsk = setTimeout(() => setPhase("ask"), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(toLeaving);
      clearTimeout(toAsk);
    };
  }, [freeze]);

  function createAccount() {
    // /dev/screens: hand off to the funnel instead of leaving for an identity
    // provider, so the walkthrough continues into onboarding.
    if (preview) return preview.advance("/onboarding/verify-email");
    startPending(async () => {
      // Arm the claim cookie BEFORE leaving for Google. The school email on
      // file and the personal address Google returns are different strings, so
      // /auth/callback cannot reconnect them by matching — this token is the
      // only link between the registration and the account.
      await stageGuestClaim(token);
      if (devBypass) {
        window.location.href = "/api/dev-login?role=onboarding&next=/profile";
        return;
      }
      await signIn();
    });
  }

  const waitlisted = context.rsvpStatus === "waitlisted";
  const firstName = context.firstName || "friend";

  if (phase !== "ask") {
    return (
      <OnbSection fill>
        <div
          aria-live="polite"
          style={{ transitionDuration: `${FADE_MS}ms` }}
          className={`flex flex-col items-center gap-5 pt-[12vh] text-center transition-opacity ease-out motion-reduce:transition-none ${
            phase === "leaving" ? "opacity-0" : "opacity-100"
          }`}
        >
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]"
          >
            <Check size={26} strokeWidth={2.5} />
          </span>
          <h1
            className="text-balance font-bold tracking-tight text-foreground"
            style={{ fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1.1 }}
          >
            {waitlisted
              ? `You're on the list, ${firstName}.`
              : `Nice, you're in, ${firstName}.`}
          </h1>
        </div>
      </OnbSection>
    );
  }

  return (
    <OnbSection>
      <OnbSurface>
        <OnbIntro title="Almost there!">
          {waitlisted
            ? "Finish your profile to get connected with companies & the community — and members get first call on spots that open up."
            : "Finish your profile to get connected with companies & the community."}
        </OnbIntro>

        {googleError ? (
          <OnbErrorBox className="mt-6">{googleError}</OnbErrorBox>
        ) : null}
      </OnbSurface>

      <OnbActionBar>
        <div className="flex w-full max-w-[24rem] flex-col items-center gap-3">
          <OnbPrimaryButton
            loading={googlePending || pending}
            onClick={createAccount}
          >
            {googlePending || pending
              ? "Redirecting…"
              : devBypass
                ? "Continue (dev bypass)"
                : "Continue with Google"}
          </OnbPrimaryButton>

          {devBypass ? (
            <p className="text-center text-[11.5px] text-muted-foreground">
              Local build — skips Google, claim still runs for real.
            </p>
          ) : null}

          {/* A text link, not a second button. These are not equal choices and
              the layout should not pretend otherwise. */}
          <Link
            href={`/events/${context.eventSlug}`}
            className="rounded text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Not right now
          </Link>
        </div>
      </OnbActionBar>
    </OnbSection>
  );
}
