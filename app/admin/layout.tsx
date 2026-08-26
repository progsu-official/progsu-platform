import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  loadOnboardingState,
  onboardingPathFor,
} from "@/lib/auth/onboarding";

import { AdminNav } from "./_components/admin-nav";
import { AdminAvatarMenu } from "./_components/avatar-menu";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, first_name, avatar_url")
    .eq("id", user.id)
    .single();

  // 404 (not 403) for non-admins so admin surface doesn't leak route existence.
  if (!profile?.is_admin) notFound();

  // D8: admins bypass the member onboarding cascade, so a brand-new admin can
  // land here with no member profile at all. Nudge (persistently, on every
  // admin page) rather than gate — their member profile feeds events, the
  // directory, and recruiter exports.
  const onboarding = await loadOnboardingState(supabase, user.id);
  const onboardingHref =
    onboardingPathFor(onboarding.nextStep) ?? "/onboarding/profile";

  const displayName = profile.first_name ?? user.email ?? "Admin";

  return (
    <div className="dark min-h-screen bg-background text-foreground antialiased">
      {/* One top bar for every screen size, same idea as the member header
          (app/_components/member-header.tsx): logo, nav, account cluster on
          the right — no sidebar. */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4">
          <Link href="/admin" className="flex shrink-0 items-baseline gap-1.5">
            <span className="text-[15px] font-bold tracking-tight text-foreground">
              progsu
            </span>
            <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-widest text-primary">
              admin
            </span>
          </Link>

          <AdminNav
            showEvents={env.FEATURE_EVENTS}
            showLinks={env.FEATURE_REFERRAL_LINKS}
          />

          <AdminAvatarMenu
            displayName={displayName}
            avatarUrl={profile.avatar_url ?? null}
          />
        </div>
      </header>

      <main className="p-6 lg:p-8">
        {!onboarding.fullyOnboarded ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
            <div className="text-sm">
              <p className="font-medium text-amber-200">
                Your member profile isn&apos;t set up yet.
              </p>
              <p className="text-amber-200/70">
                Admin access works without it, but events, the member
                directory, and recruiter exports need a completed profile.
              </p>
            </div>
            <Link
              href={onboardingHref}
              className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-300"
            >
              Finish setup
            </Link>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
