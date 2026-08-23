import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { OnbIntro, OnbSection } from "../_components/shell";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  school: string | null;
  student_email_verified: boolean;
  major: string | null;
  major_other_text: string | null;
  minor: string | null;
  phone_number: string | null;
};

type MajorRow = { slug: string; label: string };

export default async function OnboardingProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  if (state.nextStep !== "profile" && state.nextStep !== null) {
    const next = onboardingPathFor(state.nextStep);
    if (next) redirect(next);
  }
  if (state.fullyOnboarded) redirect("/profile");

  const [{ data: profile }, { data: majors }, { data: domains }, { data: legacyMatch }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "first_name, last_name, preferred_name, school, student_email_verified, major, major_other_text, minor, phone_number"
        )
        .eq("id", user.id)
        .single<ProfileRow>(),
      supabase
        .from("majors")
        .select("slug, label")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("school_domains")
        .select("school_name")
        .eq("is_active", true)
        .order("school_name"),
      // If old member data (Luma/Sheets import) matched this account on first
      // login, let them know something got pre-filled instead of leaving it
      // silent. This is the guaranteed first page after OAuth — verify-email
      // is optional and easily skipped, so the banner belongs here, not there.
      supabase
        .from("legacy_members")
        .select("id")
        .eq("claimed_profile_id", user.id)
        .maybeSingle(),
    ]);

  const majorOptions: MajorRow[] = (majors ?? []).map((m) => ({
    slug: m.slug as string,
    label: m.label as string,
  }));
  const schoolOptions = Array.from(
    new Set((domains ?? []).map((d) => d.school_name as string))
  );
  return (
    <OnbSection>
      <ProfileForm
        intro={
          <OnbIntro title="The basics">
            Just trying to get to know you. Five fields, everything else can wait.
          </OnbIntro>
        }
        notice={
          legacyMatch ? (
            <div className="rounded-[14px] border border-primary/25 bg-primary/[0.06] px-4 py-3 text-center text-sm text-primary">
              You’ve been to a Progsu event before, so we filled in what we already
              had. Worth a quick look.
            </div>
          ) : null
        }
        initial={{
          // Test mode fills any still-empty required field with a dummy value
          // so the form submits on a single click. Optional fields stay empty
          // even in test mode, there's nothing to fill on their behalf.
          firstName:
            profile?.first_name || (env.ONBOARDING_TEST_MODE ? "Test" : ""),
          lastName:
            profile?.last_name || (env.ONBOARDING_TEST_MODE ? "Student" : ""),
          preferredName: profile?.preferred_name ?? "",
          school:
            profile?.school ||
            (env.ONBOARDING_TEST_MODE ? schoolOptions[0] ?? "" : ""),
          schoolOtherText: "",
          phoneNumber:
            profile?.phone_number ||
            (env.ONBOARDING_TEST_MODE ? "(404) 555-0123" : ""),
          major:
            profile?.major ||
            (env.ONBOARDING_TEST_MODE
              ? majorOptions.find((m) => m.slug !== "other")?.slug ?? ""
              : ""),
          majorOtherText: profile?.major_other_text ?? "",
          minor: profile?.minor ?? "",
        }}
        majorOptions={majorOptions}
        schoolOptions={schoolOptions}
      />
    </OnbSection>
  );
}
