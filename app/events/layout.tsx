import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";
import { signOut } from "@/lib/actions/session";
import { Button } from "@/components/ui/button";

import { EventsNav } from "./_components/events-nav";

export const dynamic = "force-dynamic";

export default async function EventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Kill switch per plan §14.5. Flag off = 404 for everyone before any auth
  // work runs, so the route doesn't leak through timing.
  if (!env.FEATURE_EVENTS) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadOnboardingState(supabase, user.id);
  // Admins can view the member events surface (e.g., to preview how it looks
  // or walk through an RSVP themselves). They also have /admin/events.
  // Non-admins must finish onboarding before reaching /events.
  if (!state.isAdmin && !state.fullyOnboarded) {
    const next = onboardingPathFor(state.nextStep) ?? "/onboarding/verify-email";
    redirect(next);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, pending_domain_name")
    .eq("id", user.id)
    .single();
  const displayName =
    profile?.first_name ?? user.user_metadata?.given_name ?? "You";
  const pendingDomainName =
    (profile?.pending_domain_name as string | null | undefined) ?? null;

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
            <EventsNav />
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
      <main className="mx-auto max-w-5xl px-4 py-8">
        {!state.studentEmailVerified ? (
          <StudentEmailNudge pendingDomainName={pendingDomainName} />
        ) : null}
        {!state.isAdmin && !state.hasCurrentResume ? <ResumeNudge /> : null}
        {children}
      </main>
    </div>
  );
}

// Matches the dashboard nudge copy + styling. Kept inline instead of
// importing from /dashboard to avoid a cross-surface dependency.
function StudentEmailNudge({
  pendingDomainName,
}: {
  pendingDomainName: string | null;
}) {
  if (pendingDomainName) {
    return (
      <section className="mb-6 flex items-start justify-between gap-4 rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
        <div>
          <p className="font-medium text-foreground">
            {pendingDomainName} is coming soon
          </p>
          <p className="mt-1 text-muted-foreground">
            Your school isn&apos;t on our verification list yet. You can still
            RSVP to events, but you won&apos;t appear as a verified student to
            hosts until we add it.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/onboarding/verify-email">Change email</Link>
        </Button>
      </section>
    );
  }
  return (
    <section className="mb-6 flex items-start justify-between gap-4 rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
      <div>
        <p className="font-medium text-foreground">
          Verify your student email to fully participate in events
        </p>
        <p className="mt-1 text-muted-foreground">
          You can RSVP without verification, but hosts rely on verified student
          status for school-gated events.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/onboarding/verify-email">Verify now</Link>
      </Button>
    </section>
  );
}

function ResumeNudge() {
  return (
    <section className="mb-6 flex items-start justify-between gap-4 rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
      <div>
        <p className="font-medium text-foreground">
          Add your resume so recruiters can find you
        </p>
        <p className="mt-1 text-muted-foreground">
          Recruiters only see profiles with a resume on file. You can still
          RSVP without one.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/dashboard/settings#resume">Upload resume</Link>
      </Button>
    </section>
  );
}
