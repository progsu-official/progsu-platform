import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  getRequestOnboardingState,
  getRequestUser,
} from "@/lib/auth/request-cache";
import { env } from "@/lib/env";
import { readTheme } from "@/lib/theme";

import { MemberHeader } from "@/app/_components/member-header";
import { SiteFooter } from "@/app/_components/site-footer";
import { ThemeShell } from "@/app/_components/theme-shell";

export const dynamic = "force-dynamic";

export default async function MembersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Kill switch: flag off = 404 for everyone before any auth work runs.
  if (!env.FEATURE_MEMBER_DIRECTORY) notFound();

  // Deduped for this request: the page under this layout asks for the same
  // two things, and without the shared cache each navigation paid for both
  // twice before any page data was fetched.
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  // The directory is open to anyone signed in. It used to bounce members who
  // were mid-onboarding to /onboarding/<step>, with an exemption for admins --
  // which is how a stale privacy_policy version could empty the directory for
  // admins while every other member was redirected away from it entirely.
  //
  // The detail page never had this gate: can_view_member_card has only ever
  // asked whether the *target* is discoverable, not whether the viewer finished
  // onboarding. The list was the outlier, so this drops the gate rather than
  // extending it. list_member_cards was relaxed to match in 20260820160000 --
  // both layers have to agree or the page renders over an empty result set.
  //
  // Still enforced above: the feature flag, and being signed in at all.
  const state = await getRequestOnboardingState(user.id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, avatar_url")
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <SiteFooter />
    </ThemeShell>
  );
}
