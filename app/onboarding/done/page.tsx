import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { StepHeader } from "../_components/step-header";
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
    <section className="py-10">
      <StepHeader
        title="You're in"
        description="Taking you to your profile…"
      />
      <DoneRedirect />
    </section>
  );
}
