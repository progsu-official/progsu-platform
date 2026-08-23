import { redirect } from "next/navigation";
import { Check } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import {
  OnbActionBar,
  OnbIntro,
  OnbPrimaryButton,
  OnbSection,
  OnbSurface,
} from "../_components/shell";
import { DoneRedirect } from "./done-redirect";

export const dynamic = "force-dynamic";

export default async function OnboardingDonePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);

  // If they arrived here without being fully done, send them to the next outstanding step.
  if (!state.fullyOnboarded) {
    const next = onboardingPathFor(state.nextStep) ?? "/onboarding/verify-email";
    redirect(next);
  }

  return (
    <OnbSection>
      <OnbSurface>
        <div className="flex flex-col items-center gap-5 text-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]"
          >
            <Check size={26} strokeWidth={2.5} />
          </span>
          <OnbIntro title="That’s you, done.">
            You’re on the list, you’ll get the emails, and your profile is live
            for the rest of the community.
          </OnbIntro>
        </div>
      </OnbSurface>
      <OnbActionBar>
        <OnbPrimaryButton href="/profile">Go to my profile</OnbPrimaryButton>
      </OnbActionBar>
      <DoneRedirect />
    </OnbSection>
  );
}
