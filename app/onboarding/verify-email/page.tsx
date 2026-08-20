import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState } from "@/lib/auth/onboarding";

import { StepHeader } from "../_components/step-header";
import { VerifyEmailForm } from "./verify-email-form";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);

  // Pre-fill with an existing (but unverified) student email so a user who refreshes
  // mid-flow can resume instead of re-typing.
  const { data: profile } = await supabase
    .from("profiles")
    .select("student_email, student_email_verified")
    .eq("id", user.id)
    .single();
  let initialEmail =
    profile && !profile.student_email_verified ? profile.student_email ?? "" : "";
  const alreadyVerified = Boolean(profile?.student_email_verified);

  // Test mode: pre-fill a dummy address on an allowlisted domain, unique per
  // user so parallel test accounts don't trip the duplicate-email guard.
  if (env.ONBOARDING_TEST_MODE && !initialEmail && !alreadyVerified) {
    const { data: domainRow } = await supabase
      .from("school_domains")
      .select("domain")
      .eq("is_active", true)
      .order("domain")
      .limit(1)
      .maybeSingle();
    if (domainRow?.domain) {
      initialEmail = `test-${user.id.slice(0, 8)}@${domainRow.domain}`;
    }
  }

  return (
    <section className="space-y-6">
      <StepHeader
        title={
          alreadyVerified
            ? "Your student email is verified"
            : "Verify your student email"
        }
        description={
          alreadyVerified
            ? `You verified ${profile?.student_email}. You can change the email on file by verifying a new one below.`
            : "Enter your school email and we'll send a 6-digit code. This isn't required to finish signing up, but recruiters only see verified members."
        }
      />
      <VerifyEmailForm
        initialEmail={initialEmail}
        fullyOnboarded={state.fullyOnboarded}
      />
    </section>
  );
}
