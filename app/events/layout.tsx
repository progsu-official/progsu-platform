import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  getRequestOnboardingState,
  getRequestUser,
} from "@/lib/auth/request-cache";
import { env } from "@/lib/env";
import { readTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

import { MemberHeader } from "@/app/_components/member-header";
import { ThemeShell } from "@/app/_components/theme-shell";

export const dynamic = "force-dynamic";

export default async function EventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Kill switch per plan §14.5. Flag off = 404 for everyone before any auth
  // work runs, so the route doesn't leak through timing.
  if (!env.FEATURE_EVENTS) notFound();

  // Deduped for this request: the page under this layout asks for the same
  // two things, and without the shared cache each navigation paid for both
  // twice before any page data was fetched.
  //
  // No auth/onboarding gate here — per the 2026-08-20 RSVP-first decision the
  // event detail page under this layout is public. The /events list page
  // (app/events/page.tsx) still requires a signed-in, fully-onboarded member
  // and enforces that itself. This layout only renders what it can for
  // whoever shows up: full member chrome for a fully-onboarded user, a
  // sign-in link in the header for anyone else.
  const user = await getRequestUser();
  const supabase = await createClient();

  const state = user ? await getRequestOnboardingState(user.id) : null;

  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("first_name, avatar_url, pending_domain_name")
          .eq("id", user.id)
          .single()
      ).data
    : null;
  const displayName = user
    ? profile?.first_name ?? user.user_metadata?.given_name ?? "You"
    : null;
  const pendingDomainName =
    (profile?.pending_domain_name as string | null | undefined) ?? null;

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
      <main className="mx-auto max-w-5xl px-4 py-8">
        {state && !state.studentEmailVerified ? (
          <StudentEmailNudge pendingDomainName={pendingDomainName} />
        ) : null}
        {state && !state.isAdmin && !state.hasCurrentResume ? (
          <ResumeNudge />
        ) : null}
        {children}
      </main>
    </ThemeShell>
  );
}

// Matches the dashboard nudge copy + styling. Kept inline instead of
// importing from /profile to avoid a cross-surface dependency.
function StudentEmailNudge({
  pendingDomainName,
}: {
  pendingDomainName: string | null;
}) {
  if (pendingDomainName) {
    return (
      <section className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
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
    <section className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
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
    <section className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
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
        <Link href="/profile/settings/resume">Upload resume</Link>
      </Button>
    </section>
  );
}
