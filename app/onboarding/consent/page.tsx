import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

export default async function OnboardingConsentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  if (state.isAdmin) redirect("/admin");
  if (!state.studentEmailVerified) redirect("/onboarding/verify-email");
  if (!state.profileFieldsComplete) redirect("/onboarding/profile");
  if (!state.hasCurrentResume) redirect("/onboarding/resume");
  if (state.nextStep !== "consent" && state.nextStep !== null) {
    const next = onboardingPathFor(state.nextStep);
    if (next) redirect(next);
  }
  if (state.fullyOnboarded) redirect("/dashboard");

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone_number")
    .eq("id", user.id)
    .single();
  const hasPhone = (profile?.phone_number ?? "").length >= 7;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Consents</h1>
        <p className="text-sm text-muted-foreground">
          Privacy and terms are required. The rest is optional and you can change
          any of it later.
        </p>
      </header>
      <ConsentForm hasPhone={hasPhone} />
    </section>
  );
}
