import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState } from "@/lib/auth/onboarding";

import { ResumeUploader } from "./resume-uploader";

export const dynamic = "force-dynamic";

export default async function OnboardingResumePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  if (state.isAdmin) redirect("/admin");
  if (!state.profileFieldsComplete) redirect("/onboarding/profile");
  // Resume is a soft step — nextStep is never "resume" (see lib/auth/onboarding).
  // Allowed arrivals here: a freshly-onboarded user post-profile
  // (nextStep === "consent"), a fully onboarded user visiting to upload later
  // (nextStep === null), or a not-yet-consented user via a nudge link.
  // We DO NOT bounce them forward — they chose this page, render it.

  const { data: current } = await supabase
    .from("resumes")
    .select("id, file_name, file_size, uploaded_at")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Upload your resume</h1>
        <p className="text-sm text-muted-foreground">
          PDF only, up to 10 MB. You can replace it any time from your dashboard.
        </p>
      </header>
      <div className="rounded-md border border-muted-foreground/20 bg-muted/20 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Tip:</strong> remove your SSN, date of
        birth, and home address before uploading — recruiters don&apos;t need them.
      </div>
      <ResumeUploader
        currentFileName={current?.file_name ?? null}
        currentUploadedAt={current?.uploaded_at ?? null}
      />
    </section>
  );
}
