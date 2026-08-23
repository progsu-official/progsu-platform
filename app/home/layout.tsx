import { createClient } from "@/lib/supabase/server";
import { getRequestOnboardingState, getRequestUser } from "@/lib/auth/request-cache";
import { env } from "@/lib/env";
import { readTheme } from "@/lib/theme";

import { MemberHeader } from "@/app/_components/member-header";
import { ThemeShell } from "@/app/_components/theme-shell";

export const dynamic = "force-dynamic";

// Fully public, mirrors events/layout.tsx's signed-out handling: full member
// chrome for a signed-in user, a sign-in link in the header for anyone else.
// No onboarding gate — this is the visitor-facing hub, not a member surface.
export default async function HomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getRequestUser();
  const supabase = await createClient();

  const state = user ? await getRequestOnboardingState(user.id) : null;
  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("first_name, avatar_url")
          .eq("id", user.id)
          .single()
      ).data
    : null;
  const displayName = user
    ? profile?.first_name ?? user.user_metadata?.given_name ?? "You"
    : null;

  const theme = await readTheme();

  return (
    <ThemeShell initialTheme={theme}>
      <MemberHeader
        displayName={displayName}
        email={user?.email ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        isAdmin={state?.isAdmin ?? false}
        showMembers={env.FEATURE_MEMBER_DIRECTORY}
        showEvents={env.FEATURE_EVENTS}
      />
      <main className="mx-auto max-w-5xl px-4 pb-8">{children}</main>
    </ThemeShell>
  );
}
