import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  school: string | null;
  student_email_verified: boolean;
  major: string | null;
  major_other_text: string | null;
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
          "first_name, last_name, school, student_email_verified, major, major_other_text, phone_number"
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
  const schoolAutoFilled =
    !!profile?.student_email_verified && !!profile?.school;

  return (
    <section className="space-y-6">
      {legacyMatch && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          Welcome back! We found your info from Progsu&apos;s past events and
          filled in what we had. Feel free to double-check it below.
        </div>
      )}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <p className="text-sm text-muted-foreground">
          A few quick basics to get you on the platform. You can finish the rest
          (graduation info, roles, resume, links) from your dashboard.
        </p>
      </header>
      <ProfileForm
        initial={{
          firstName: profile?.first_name ?? "",
          lastName: profile?.last_name ?? "",
          school: profile?.school ?? "",
          schoolOtherText: "",
          phoneNumber: profile?.phone_number ?? "",
          major: profile?.major ?? "",
          majorOtherText: profile?.major_other_text ?? "",
        }}
        majorOptions={majorOptions}
        schoolOptions={schoolOptions}
        schoolAutoFilled={schoolAutoFilled}
      />
    </section>
  );
}
