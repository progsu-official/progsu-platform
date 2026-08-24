import Link from "next/link";
import { notFound } from "next/navigation";

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
  const showStudentNudge = !!state && !state.studentEmailVerified;
  const showResumeNudge = !!state && !state.isAdmin && !state.hasCurrentResume;

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
      {/* Sticky right under the header (h-14 = top-14), not an inline card in
          the page's own content flow — a soft "you can still RSVP" nudge
          shouldn't read as its own content section competing with the page
          for space. One sticky wrapper so up to two bars stack via normal
          flow inside it, instead of each needing its own hand-computed
          sticky offset. */}
      {showStudentNudge || showResumeNudge ? (
        <div className="sticky top-14 z-30">
          {showStudentNudge ? (
            <StudentEmailNudge pendingDomainName={pendingDomainName} />
          ) : null}
          {showResumeNudge ? <ResumeNudge /> : null}
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-8">{children}</main>
      <SiteFooter />
    </ThemeShell>
  );
}

// Matches the dashboard nudge copy. Kept inline instead of importing from
// /profile to avoid a cross-surface dependency.
function StudentEmailNudge({
  pendingDomainName,
}: {
  pendingDomainName: string | null;
}) {
  if (pendingDomainName) {
    return (
      <NudgeBar
        headline={`${pendingDomainName} is coming soon`}
        detail="Your school isn't on our verification list yet. You can still RSVP to events, but you won't appear as a verified student to hosts until we add it."
        href="/onboarding/verify-email"
        cta="Change email"
      />
    );
  }
  return (
    <NudgeBar
      headline="Verify your student email to fully participate in events"
      detail="You can RSVP without verification, but hosts rely on verified student status for school-gated events."
      href="/onboarding/verify-email"
      cta="Verify now"
    />
  );
}

function ResumeNudge() {
  return (
    <NudgeBar
      headline="Add your resume so recruiters can find you"
      detail="Recruiters only see profiles with a resume on file — you can still RSVP without one."
      href="/profile/settings/resume"
      cta="Upload resume"
    />
  );
}

// Headline + CTA share the top line (matches the old card's title-plus-button
// layout); the explanatory sentence sits below it, dimmer — two lines, not
// one crammed run-on sentence.
function NudgeBar({
  headline,
  detail,
  href,
  cta,
}: {
  headline: string;
  detail: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/20 px-4 py-1.5 text-center text-xs sm:text-sm">
      <div className="flex flex-wrap items-center justify-center gap-x-2">
        <span className="font-medium text-foreground">{headline}</span>
        <Link
          href={href}
          className="font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
        >
          {cta} →
        </Link>
      </div>
      <p className="mt-0.5 text-muted-foreground">{detail}</p>
    </div>
  );
}
