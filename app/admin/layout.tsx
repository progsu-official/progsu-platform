import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, Eye } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { signOut } from "@/lib/actions/session";
import {
  loadOnboardingState,
  onboardingPathFor,
} from "@/lib/auth/onboarding";

import { AdminNav } from "./_components/admin-nav";

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
    .select("is_admin, first_name")
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
      <div className="flex min-h-screen">
        <aside className="hidden w-60 flex-col border-r border-border/60 bg-card/30 md:flex">
          <div className="px-5 pb-2 pt-5">
            <Link href="/admin" className="flex items-baseline gap-2">
              <span className="text-[15px] font-bold tracking-tight text-foreground">
                progsu
              </span>
              <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-widest text-primary">
                admin
              </span>
            </Link>
          </div>

          <AdminNav showEvents={env.FEATURE_EVENTS} />

          {/* Deliberately louder than the nav: switching surfaces is the one
              action here that leaves the admin, so it reads as a button, not
              a nav row. */}
          <div className="px-3 pb-3">
            <Link
              href="/profile"
              className="group flex items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-3 text-sm font-medium text-primary transition-colors hover:border-primary/60 hover:bg-primary/20"
            >
              <span className="flex items-center gap-2.5">
                <Eye size={15} strokeWidth={1.75} aria-hidden />
                View as member
              </span>
              <ArrowUpRight
                size={14}
                strokeWidth={2}
                aria-hidden
                className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          <div className="flex items-center gap-2.5 border-t border-border/60 px-4 py-3.5">
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold uppercase text-primary"
            >
              {displayName.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {displayName}
              </p>
              <p className="text-[10px] text-muted-foreground">Signed in</p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-6 lg:p-8">
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
    </div>
  );
}
