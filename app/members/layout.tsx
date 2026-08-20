import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { MemberHeader } from "@/app/_components/member-header";

export const dynamic = "force-dynamic";

export default async function MembersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Kill switch: flag off = 404 for everyone before any auth work runs.
  if (!env.FEATURE_MEMBER_DIRECTORY) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  // Admins bypass onboarding (same contract as /dashboard). They can still
  // browse /members for support/moderation — no bounce.
  if (!state.isAdmin && !state.fullyOnboarded) {
    const next = onboardingPathFor(state.nextStep) ?? "/onboarding/verify-email";
    redirect(next);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, avatar_url")
    .eq("id", user.id)
    .single();
  const displayName =
    profile?.first_name ?? user.user_metadata?.given_name ?? "You";

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <MemberHeader
        displayName={displayName}
        email={user.email ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        isAdmin={state.isAdmin}
        showMembers={env.FEATURE_MEMBER_DIRECTORY}
        showEvents={env.FEATURE_EVENTS}
      />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
