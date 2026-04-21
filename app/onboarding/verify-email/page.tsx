import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { VerifyEmailForm } from "./verify-email-form";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  // If they're past this step, advance to the next one.
  if (state.nextStep !== "verify-email" && state.nextStep !== null) {
    const next = onboardingPathFor(state.nextStep);
    if (next) redirect(next);
  }
  if (state.fullyOnboarded) redirect("/dashboard");

  // Pre-fill with an existing (but unverified) student email so a user who refreshes
  // mid-flow can resume instead of re-typing.
  const { data: profile } = await supabase
    .from("profiles")
    .select("student_email, student_email_verified")
    .eq("id", user.id)
    .single();
  const initialEmail =
    profile && !profile.student_email_verified ? profile.student_email ?? "" : "";

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Verify your student email</h1>
        <p className="text-sm text-muted-foreground">
          Enter your school email. We&apos;ll send a 6-digit code to confirm you&apos;re a
          student.
        </p>
      </header>
      <VerifyEmailForm initialEmail={initialEmail} />
    </section>
  );
}
