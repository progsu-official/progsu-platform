import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";
import { signOut } from "@/lib/actions/session";

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
    .select("first_name")
    .eq("id", user.id)
    .single();
  const displayName =
    profile?.first_name ?? user.user_metadata?.given_name ?? "You";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link
            href="/dashboard"
            className="text-base font-semibold tracking-tight"
          >
            Progsu
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/dashboard"
              className="text-muted-foreground hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link
              href="/members"
              className="font-medium hover:text-foreground"
            >
              Members
            </Link>
            <Link
              href="/dashboard/settings"
              className="text-muted-foreground hover:text-foreground"
            >
              Settings
            </Link>
            <span aria-hidden className="h-4 w-px bg-muted-foreground/20" />
            <span className="text-sm text-muted-foreground">{displayName}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent/10"
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
