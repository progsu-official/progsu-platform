import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  school: string | null;
  major: string | null;
  minor: string | null;
  class_standing: string | null;
  grad_year: number | null;
  grad_term: string | null;
  interested_roles: string[] | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  phone_number: string | null;
};

export default async function OnboardingProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  if (state.isAdmin) redirect("/admin");
  if (!state.studentEmailVerified) redirect("/onboarding/verify-email");
  // If they already have a full profile AND are further along, forward to next step.
  if (state.nextStep !== "profile" && state.nextStep !== null) {
    const next = onboardingPathFor(state.nextStep);
    if (next) redirect(next);
  }
  if (state.fullyOnboarded) redirect("/dashboard");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "first_name, last_name, preferred_name, school, major, minor, class_standing, grad_year, grad_term, interested_roles, linkedin_url, github_url, portfolio_url, phone_number"
    )
    .eq("id", user.id)
    .single<ProfileRow>();

  const { data: domains } = await supabase
    .from("school_domains")
    .select("school_name")
    .eq("is_active", true)
    .order("school_name");

  const schoolOptions = Array.from(
    new Set((domains ?? []).map((d) => d.school_name))
  );

  // Extract the "term" half out of "Fall 2027" if we have a prior value.
  const priorGradTermRaw = profile?.grad_term ?? null;
  const priorGradTerm = priorGradTermRaw?.split(" ")[0] ?? null;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <p className="text-sm text-muted-foreground">
          Tell us a little about yourself. You can update any of this later.
        </p>
      </header>
      <ProfileForm
        initial={{
          firstName: profile?.first_name ?? "",
          lastName: profile?.last_name ?? "",
          preferredName: profile?.preferred_name ?? "",
          school: profile?.school ?? "",
          major: profile?.major ?? "",
          minor: profile?.minor ?? "",
          classStanding: profile?.class_standing ?? "",
          gradYear: profile?.grad_year ?? null,
          gradTerm: priorGradTerm ?? "",
          interestedRoles: profile?.interested_roles ?? [],
          linkedinUrl: profile?.linkedin_url ?? "",
          githubUrl: profile?.github_url ?? "",
          portfolioUrl: profile?.portfolio_url ?? "",
          phoneNumber: profile?.phone_number ?? "",
        }}
        schoolOptions={schoolOptions}
      />
    </section>
  );
}
