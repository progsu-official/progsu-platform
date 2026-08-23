import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState } from "@/lib/auth/onboarding";

import { OnbIntro, OnbSection } from "../_components/shell";
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
    <OnbSection>
      <VerifyEmailForm
        initialEmail={initialEmail}
        fullyOnboarded={state.fullyOnboarded}
        intro={
          alreadyVerified ? (
            <OnbIntro title="Your school email is verified">
              {profile?.student_email} is on file. Verify a different one below to
              swap it.
            </OnbIntro>
          ) : (
            <OnbIntro title="Let’s confirm you’re a student">
              A verified school email is what puts you in front of recruiters.
            </OnbIntro>
          )
        }
      />
    </OnbSection>
  );
}
