import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState } from "@/lib/auth/onboarding";

import { OnbSection } from "../_components/shell";
import { LinksForm } from "./links-form";

export const dynamic = "force-dynamic";

type ProfileRow = {
  class_standing: string | null;
  grad_year: number | null;
  grad_term: string | null;
  interested_roles: string[] | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  bio: string | null;
};

export default async function OnboardingLinksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  if (!state.profileFieldsComplete) redirect("/onboarding/profile");
  // Soft step like resume, nextStep never points here (see lib/auth/onboarding).
  // Allowed arrivals: the natural post-profile push, or someone revisiting to
  // edit later. We don't bounce forward, they chose this page, render it.

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "class_standing, grad_year, grad_term, interested_roles, linkedin_url, github_url, portfolio_url, bio"
    )
    .eq("id", user.id)
    .single<ProfileRow>();

  return (
    <OnbSection>
      <LinksForm
        initial={{
          classStanding:
            profile?.class_standing ||
            (env.ONBOARDING_TEST_MODE ? "junior" : ""),
          gradYear:
            profile?.grad_year ??
            (env.ONBOARDING_TEST_MODE ? new Date().getFullYear() + 1 : null),
          gradTerm:
            profile?.grad_term?.split(" ")[0] ||
            (env.ONBOARDING_TEST_MODE ? "Fall" : ""),
          interestedRoles:
            profile?.interested_roles ??
            (env.ONBOARDING_TEST_MODE ? ["software_engineering"] : []),
          linkedinUrl: profile?.linkedin_url ?? "",
          githubUrl: profile?.github_url ?? "",
          portfolioUrl: profile?.portfolio_url ?? "",
          bio: profile?.bio ?? "",
        }}
      />
    </OnbSection>
  );
}
