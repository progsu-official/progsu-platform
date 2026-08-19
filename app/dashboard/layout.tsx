import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";
import { getOwnVisibilitySettings } from "@/lib/actions/members";

import { MemberHeader } from "@/app/_components/member-header";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  // Admins bypass onboarding; non-admins must finish it before hitting the
  // dashboard (same contract as before — we just don't force admins away from
  // member surfaces anymore).
  if (!state.isAdmin && !state.fullyOnboarded) {
    const next = onboardingPathFor(state.nextStep) ?? "/onboarding/verify-email";
    redirect(next);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, avatar_url")
    .eq("id", user.id)
    .single();
  const displayName =
    profile?.first_name ?? user.user_metadata?.given_name ?? "You";

  const visibility = await getOwnVisibilitySettings();
  const ownSlug = visibility.ok ? (visibility.data?.profile_slug ?? null) : null;
  const profileHref =
    env.FEATURE_MEMBER_DIRECTORY && ownSlug ? `/members/${ownSlug}` : "/dashboard";

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <MemberHeader
        displayName={displayName}
        avatarUrl={profile?.avatar_url ?? null}
        isAdmin={state.isAdmin}
        showMembers={env.FEATURE_MEMBER_DIRECTORY}
        showEvents={env.FEATURE_EVENTS}
        profileHref={profileHref}
      />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
