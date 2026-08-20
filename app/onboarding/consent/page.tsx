import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { StepHeader } from "../_components/step-header";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

export default async function OnboardingConsentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  if (!state.profileFieldsComplete) redirect("/onboarding/profile");
  // Note: we do NOT redirect back to /onboarding/resume here. Resume is a
  // soft step — users can Skip for now and still complete consent. The
  // dashboard + inline nudges keep prompting them to upload later.
  if (state.nextStep !== "consent" && state.nextStep !== null) {
    const next = onboardingPathFor(state.nextStep);
    if (next) redirect(next);
  }
  if (state.fullyOnboarded) redirect("/profile");

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone_number")
    .eq("id", user.id)
    .single();
  const hasPhone = (profile?.phone_number ?? "").length >= 7;

  return (
    <section className="space-y-7">
      <StepHeader
        title="Last thing"
        description="Privacy and terms are required. Everything else is optional, and you can change any of it later from your settings."
      />
      <ConsentForm
        hasPhone={hasPhone}
        prefillRequired={env.ONBOARDING_TEST_MODE}
      />
    </section>
  );
}
