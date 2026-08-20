import Link from "next/link";
import { CalendarDays, Camera } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { resolveCoverUrls } from "@/lib/events/cover-url";
import { loadProfileCompletion } from "@/lib/auth/profile-completion";
import { CLASS_STANDING_LABELS } from "@/lib/enums/roles";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/app/_components/avatar";

import { OpenToRecruitersToggle } from "./open-to-recruiters-toggle";
import { ProfileCompletionRing } from "./profile-completion-ring";
import { StaleConsentBanner } from "./stale-consent-banner";
import { UpcomingEvents, type UpcomingPlan } from "./upcoming-events";
import { EducationCard, type VerificationState } from "./education-card";

export const dynamic = "force-dynamic";

const joinedFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "first_name, last_name, preferred_name, school, major, major_other_text, minor, grad_year, grad_term, class_standing, student_email, student_email_verified, pending_domain_name, open_to_recruiters, interested_roles, avatar_url, linkedin_url, github_url, created_at"
    )
    .eq("id", user.id)
    .single();

  const { data: currentResume } = await supabase
    .from("resumes")
    .select("id, file_name, uploaded_at")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();

  const completion = await loadProfileCompletion(supabase, user.id);

  const nowIso = new Date().toISOString();
  const [
    { data: consents },
    { data: versions },
    upcomingResult,
    attendedResult,
    upcomingCountResult,
  ] = await Promise.all([
    supabase
      .from("consents")
      .select("consent_type, accepted, version, accepted_at, id")
      .eq("user_id", user.id),
    supabase.from("consent_versions").select("consent_type, version"),
    env.FEATURE_EVENTS
      ? supabase
          .from("self_event_history")
          .select(
            "event_id, slug, title, starts_at, ends_at, status, location_text, cover_image_path, rsvp_status, waitlisted_at"
          )
          .gte("starts_at", nowIso)
          .in("rsvp_status", ["going", "waitlisted"])
          .in("status", ["published", "cancelled"])
          .order("starts_at", { ascending: true })
          .limit(3)
      : Promise.resolve({ data: null }),
    env.FEATURE_EVENTS
      ? supabase
          .from("self_event_history")
          .select("*", { count: "exact", head: true })
          .eq("attended", true)
      : Promise.resolve({ count: null }),
    env.FEATURE_EVENTS
      ? supabase
          .from("self_event_history")
          .select("*", { count: "exact", head: true })
          .gte("starts_at", nowIso)
          .in("rsvp_status", ["going", "waitlisted"])
          .eq("status", "published")
      : Promise.resolve({ count: null }),
  ]);
  const upcomingPlans = upcomingResult.data;
  const attendedCount = attendedResult.count ?? null;
  const upcomingCount = upcomingCountResult.count ?? null;

  // Batch-resolve cover URLs + waitlist positions for the upcoming card.
  // Both are no-op when FEATURE_EVENTS is off (plans stays null).
  let upcomingCoverUrls: Array<string | null> = [];
  const upcomingWaitlistPositions = new Map<string, number | null>();
  const upcomingGoingCounts = new Map<string, number>();
  if (upcomingPlans && upcomingPlans.length > 0) {
    const paths = (upcomingPlans as Array<{ cover_image_path: string | null }>).map(
      (r) => r.cover_image_path ?? null
    );
    upcomingCoverUrls = await resolveCoverUrls(supabase, paths);

    // Going counts come from member_visible_events, the same view /events
    // reads. Cancelled events aren't in it (it filters to published), so those
    // rows resolve to null and the card shows its cancelled state instead.
    const { data: counts } = await supabase
      .from("member_visible_events")
      .select("id, going_count")
      .in(
        "id",
        (upcomingPlans as Array<{ event_id: string }>).map((r) => r.event_id)
      );
    for (const row of (counts ?? []) as Array<Record<string, unknown>>) {
      upcomingGoingCounts.set(
        row.id as string,
        (row.going_count as number | null) ?? 0
      );
    }

    // Only fetch waitlist positions for the waitlisted rows. The helper is
    // self-scoped so each call is cheap and admin-RLS-safe.
    const waitlistedIds = (
      upcomingPlans as Array<{ event_id: string; rsvp_status: string | null }>
    )
      .filter((r) => r.rsvp_status === "waitlisted")
      .map((r) => r.event_id);
    await Promise.all(
      waitlistedIds.map(async (eventId) => {
        const { data } = await supabase.rpc("my_waitlist_position", {
          p_event_id: eventId,
        });
        const parsed = typeof data === "number" ? data : Number(data);
        upcomingWaitlistPositions.set(
          eventId,
          Number.isFinite(parsed) ? parsed : null
        );
      })
    );
  }

  // profiles.major holds a slug from the majors table; resolve it to its label
  // so the card doesn't render "computer_information_systems". Legacy rows
  // predate the table and hold free text, which falls through unchanged.
  let majorLabel = profile?.major ?? null;
  if (profile?.major === "other") {
    majorLabel = profile.major_other_text ?? null;
  } else if (profile?.major) {
    const { data: majorRow } = await supabase
      .from("majors")
      .select("label")
      .eq("slug", profile.major)
      .maybeSingle();
    if (majorRow?.label) majorLabel = majorRow.label;
  }

  const degreeLine =
    [majorLabel, profile?.minor ? `Minor in ${profile.minor}` : null]
      .filter(Boolean)
      .join(" · ") || null;
  const standingLine =
    [
      profile?.class_standing
        ? CLASS_STANDING_LABELS[
            profile.class_standing as keyof typeof CLASS_STANDING_LABELS
          ] ?? profile.class_standing
        : null,
      profile?.grad_term ? `Graduates ${profile.grad_term}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;
  const verification: VerificationState = profile?.student_email_verified
    ? "verified"
    : !profile?.student_email
      ? "none"
      : profile?.pending_domain_name
        ? "pending_domain"
        : "unverified";

  const displayName = [
    profile?.preferred_name || profile?.first_name,
    profile?.last_name,
  ]
    .filter(Boolean)
    .join(" ");
  const subline = [profile?.school, majorLabel].filter(Boolean).join(" · ");
  const joined = profile?.created_at
    ? joinedFormatter.format(new Date(profile.created_at))
    : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        <Avatar
          src={profile?.avatar_url ?? null}
          name={displayName || "?"}
          className="h-24 w-24 shrink-0 rounded-full shadow-lg shadow-black/30"
          textClassName="text-2xl"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h1 className="truncate text-3xl font-bold tracking-tight">
              {displayName || "Member"}
            </h1>
            {subline ? (
              <p className="truncate text-sm text-muted-foreground">{subline}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {joined ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={14} strokeWidth={1.75} aria-hidden />
                Joined {joined}
              </span>
            ) : null}
            {attendedCount != null ? (
              <span>
                <strong className="font-semibold text-foreground">
                  {attendedCount}
                </strong>{" "}
                Attended
              </span>
            ) : null}
            {upcomingCount != null ? (
              <span>
                <strong className="font-semibold text-foreground">
                  {upcomingCount}
                </strong>{" "}
                Upcoming
              </span>
            ) : null}
          </div>
          {profile?.linkedin_url || profile?.github_url ? (
            <div className="flex items-center gap-2">
              {profile.linkedin_url ? (
                <a
                  href={profile.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <LinkedInMark className="h-[17px] w-[17px]" />
                </a>
              ) : null}
              {profile.github_url ? (
                <a
                  href={profile.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <GitHubMark className="h-[17px] w-[17px]" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 sm:self-start">
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link href="/dashboard/settings">Edit profile</Link>
          </Button>
        </div>
      </header>

      <StaleConsentBanner consents={consents ?? []} versions={versions ?? []} />

      {/* Pending-domain banner stays — it's a "your school isn't supported yet"
          admin-ops message, not a profile-completion nudge. */}
      {!profile?.student_email_verified && profile?.pending_domain_name ? (
        <section className="flex items-start justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <div>
            <p className="font-medium text-foreground">
              {profile.pending_domain_name} is coming soon
            </p>
            <p className="mt-1 text-muted-foreground">
              Your school isn&apos;t on our verification list yet. Once we add
              it you&apos;ll be prompted to verify. Until then recruiters
              won&apos;t see your profile. You can swap to a different school
              email any time.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/onboarding/verify-email">Change email</Link>
          </Button>
        </section>
      ) : null}

      {/* Full-bleed rather than in the left column: the cover-forward cards
          need the width to stay legible at three across. */}
      {env.FEATURE_EVENTS ? (
        <UpcomingEvents
          plans={toUpcomingPlans(upcomingPlans ?? [])}
          coverUrls={upcomingCoverUrls}
          waitlistPositions={upcomingWaitlistPositions}
          goingCounts={upcomingGoingCounts}
        />
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <EducationCard
            school={profile?.school ?? null}
            degreeLine={degreeLine}
            standingLine={standingLine}
            studentEmail={profile?.student_email ?? null}
            verification={verification}
            pendingDomainName={profile?.pending_domain_name ?? null}
          />

          <div className="space-y-2 rounded-2xl border border-border/70 bg-card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Resume
          </h2>
          {currentResume ? (
            <>
              <p className="text-sm">
                <span className="font-medium">{currentResume.file_name}</span>
                <br />
                <span className="text-xs text-muted-foreground">
                  Uploaded{" "}
                  {new Date(currentResume.uploaded_at).toLocaleDateString()}
                </span>
              </p>
              <Button variant="outline" size="sm" asChild className="rounded-full">
                <Link href="/dashboard/settings#resume">Replace</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No current resume.
              </p>
              <Button size="sm" asChild className="rounded-full">
                <Link href="/dashboard/settings#resume">Upload</Link>
              </Button>
            </>
          )}
          </div>
        </div>

        <aside className="space-y-6">
          {!profile?.avatar_url ? <PhotoNudgeCard /> : null}

          <ProfileCompletionRing completion={completion} />

          <section className="rounded-2xl border border-border/70 bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Recruiter visibility</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  When on, Progsu can include you in CSV exports we share with
                  sponsors. Your name, profile, and current resume go out; your
                  Progsu dashboard stays private.
                </p>
              </div>
              <OpenToRecruitersToggle initialOpen={!!profile?.open_to_recruiters} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

// LinkedIn-style photo prompt, shown until the member has any avatar set.
function PhotoNudgeCard() {
  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/10 p-5">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-dashed border-primary/50 bg-background/40"
        >
          <Camera size={20} strokeWidth={1.75} className="text-primary" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Add a profile photo
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A clear, friendly headshot helps hosts recognize you at events and
            makes your card stand out to recruiters.
          </p>
        </div>
      </div>
      <Button asChild size="sm" className="mt-4 w-full rounded-full">
        <Link href="/dashboard/settings#photo">Upload a photo</Link>
      </Button>
    </section>
  );
}

// lucide-react no longer ships brand icons, so these two marks are inlined.
function LinkedInMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45Z" />
    </svg>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

// self_event_history comes back loosely typed; narrow it once here so the
// card component takes a real shape instead of Record<string, unknown>.
function toUpcomingPlans(rows: Array<Record<string, unknown>>): UpcomingPlan[] {
  return rows.map((r) => ({
    event_id: r.event_id as string,
    slug: r.slug as string,
    title: r.title as string,
    starts_at: r.starts_at as string,
    status: (r.status as string) ?? "published",
    location_text: (r.location_text as string | null) ?? null,
    rsvp_status: (r.rsvp_status as string | null) ?? null,
  }));
}
