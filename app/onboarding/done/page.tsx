import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { DoneRedirect } from "./done-redirect";

export const dynamic = "force-dynamic";

export default async function OnboardingDonePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  if (state.isAdmin) redirect("/admin");

  // If they arrived here without being fully done, send them to the next outstanding step.
  if (!state.fullyOnboarded) {
    const next = onboardingPathFor(state.nextStep) ?? "/onboarding/verify-email";
    redirect(next);
  }

  return (
    <section className="space-y-4 py-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re all set</h1>
      <p className="text-sm text-muted-foreground">
        Redirecting you to your dashboard…
      </p>
      <DoneRedirect />
    </section>
  );
}
