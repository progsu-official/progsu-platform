import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";
import { signOut } from "@/lib/actions/session";

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/dashboard" className="text-base font-semibold tracking-tight">
            Progsu
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/dashboard"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Overview
            </Link>
            <Link
              href="/dashboard/settings"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Settings
            </Link>
            {state.isAdmin ? (
              <Link
                href="/admin"
                className="rounded-md border border-input px-2 py-1 text-xs font-medium transition-colors hover:bg-accent/10"
              >
                Admin
              </Link>
            ) : null}
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
