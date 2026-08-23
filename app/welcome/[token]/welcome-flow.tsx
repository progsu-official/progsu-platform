"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import {
  OnbActionBar,
  OnbErrorBox,
  OnbIntro,
  OnbPrimaryButton,
  OnbSection,
  OnbSurface,
  onbPanelClasses,
} from "@/app/onboarding/_components/shell";
import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";
import { stageGuestClaim } from "@/lib/actions/guest-claim";
import { SMS_CONSENT_COPY } from "@/lib/actions/event-schemas";
import type { GuestClaimContext } from "@/lib/actions/events";
import { cn } from "@/lib/utils";

// One screen, one decision.
//
// This page used to ask three profile questions before offering sign-in. They
// are gone: they duplicated the profile completion ring, which already exists,
// already nudges, and is where someone will actually finish a profile. What is
// left is the only thing this moment is good for — turning a registration into
// an account while the person is still here.
//
// The pitch is not "give us more data". It is "we already have most of it".

export function WelcomeFlow({
  token,
  context,
}: {
  token: string;
  context: GuestClaimContext;
}) {
  const [smsOptIn, setSmsOptIn] = useState(context.smsOptedIn);
  const [pending, startPending] = useTransition();
  const { pending: googlePending, error: googleError, signIn } = useGoogleSignIn();

  const waitlisted = context.rsvpStatus === "waitlisted";

  function createAccount() {
    startPending(async () => {
      // Arm the claim cookie BEFORE leaving for Google. The school email on
      // file and the personal address Google returns are different strings, so
      // /auth/callback cannot reconnect them by matching — this token is the
      // only link between the registration and the account.
      await stageGuestClaim(token);
      await signIn();
    });
  }

  return (
    <OnbSection>
      <OnbSurface>
        <p className="mb-4 flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
          <span
            aria-hidden
            className="flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]"
          >
            <Check size={12} strokeWidth={3} />
          </span>
          <span className="truncate">
            {waitlisted ? "Waitlisted for" : "You're in —"}{" "}
            <span className="text-foreground">{context.eventTitle}</span>
          </span>
        </p>

        <OnbIntro title={`Nice one, ${context.firstName || "friend"}.`}>
          {waitlisted
            ? "Members get first call on spots that open up. Takes one tap — most of your profile is already filled in."
            : "Your spot is saved and the details are on their way. One tap makes it an account, and most of it is already filled in."}
        </OnbIntro>

        <div className={cn(onbPanelClasses, "mt-6 space-y-3")}>
          <p className="text-[13px] font-medium text-foreground">
            Already on file from your registration
          </p>
          <ul className="space-y-2">
            <Filled>Your name</Filled>
            <Filled>{context.email}</Filled>
            <Filled>Your phone number</Filled>
          </ul>
          <p className="pt-1 text-[13px] leading-[1.5] text-muted-foreground">
            Signing in carries all of that across, so you skip most of the form.
            A complete profile is what puts you in the exports we send
            recruiters.
          </p>
        </div>

        {!context.smsOptedIn ? (
          <label
            className={cn(
              onbPanelClasses,
              "mt-4 flex cursor-pointer items-start gap-3 p-3.5"
            )}
          >
            <input
              type="checkbox"
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[hsl(var(--primary))]"
            />
            <span className="text-[12.5px] leading-[1.5] text-muted-foreground">
              {SMS_CONSENT_COPY}
            </span>
          </label>
        ) : null}

        {googleError ? (
          <OnbErrorBox className="mt-4">{googleError}</OnbErrorBox>
        ) : null}
      </OnbSurface>

      <OnbActionBar>
        <div className="flex w-full max-w-[24rem] flex-col items-center gap-3">
          <OnbPrimaryButton
            loading={googlePending || pending}
            onClick={createAccount}
          >
            {googlePending ? "Redirecting…" : "Create your account with Google"}
          </OnbPrimaryButton>

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

function Filled({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-[13.5px] text-foreground">
      <Check
        size={14}
        strokeWidth={2.5}
        aria-hidden
        className="shrink-0 text-[hsl(var(--primary))]"
      />
      <span className="min-w-0 truncate">{children}</span>
    </li>
  );
}
