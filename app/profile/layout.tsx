import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  getRequestOnboardingState,
  getRequestUser,
} from "@/lib/auth/request-cache";
import { env } from "@/lib/env";
import { readTheme } from "@/lib/theme";
import { onboardingPathFor } from "@/lib/auth/onboarding";

import { MemberHeader } from "@/app/_components/member-header";
import { ThemeShell } from "@/app/_components/theme-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Deduped for this request: the page under this layout asks for the same
  // two things, and without the shared cache each navigation paid for both
  // twice before any page data was fetched.
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const state = await getRequestOnboardingState(user.id);
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

  const theme = await readTheme();

  return (
    <ThemeShell initialTheme={theme}>
      <MemberHeader
        displayName={displayName}
        email={user.email ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        isAdmin={state.isAdmin}
        showMembers={env.FEATURE_MEMBER_DIRECTORY}
        showEvents={env.FEATURE_EVENTS}
      />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </ThemeShell>
  );
}
