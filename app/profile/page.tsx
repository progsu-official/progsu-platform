import Link from "next/link";
import { CalendarDays, FileText } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { resolveCoverUrls } from "@/lib/events/cover-url";
import { loadProfileCompletion } from "@/lib/auth/profile-completion";
import { CLASS_STANDING_LABELS } from "@/lib/enums/roles";
import { Button } from "@/components/ui/button";

import { ProfileCompletionBand } from "./profile-completion-band";
import { StaleConsentBanner } from "./stale-consent-banner";
import { UpcomingEvents, MAX_PLANS, type UpcomingPlan } from "./upcoming-events";
import { EducationCard, type VerificationState } from "./education-card";
import { ResumePreview } from "./resume-preview";
import { AvatarButton } from "./avatar-button";
import { ProfileBanner } from "./profile-banner";
import { NoteBubble } from "./note-bubble";
import { LinkedInMark, GitHubMark } from "@/app/_components/brand-marks";

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
      "first_name, last_name, preferred_name, school, major, major_other_text, minor, grad_year, grad_term, class_standing, student_email, student_email_verified, pending_domain_name, open_to_recruiters, interested_roles, avatar_url, banner_url, note, linkedin_url, github_url, created_at"
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
          .limit(MAX_PLANS)
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
      <div>
        <ProfileBanner bannerUrl={profile?.banner_url ?? null} />

      {/* Pulled up over the banner so the avatar reads as anchored to it
          rather than stacked under it. */}
      <header className="-mt-14 flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-7">
        <div className="group/avatar relative shrink-0">
          <div className="absolute bottom-full left-1 mb-3">
            <NoteBubble note={profile?.note ?? null} />
          </div>
          <div className="rounded-full ring-4 ring-background">
            <AvatarButton
              avatarUrl={profile?.avatar_url ?? null}
              displayName={displayName || "?"}
            />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2 sm:pb-1">
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
            <Link href="/profile/settings">Edit profile</Link>
          </Button>
        </div>
        </header>
      </div>

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

      <ProfileCompletionBand completion={completion} />

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

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <EducationCard
            school={profile?.school ?? null}
            degreeLine={degreeLine}
            standingLine={standingLine}
            studentEmail={profile?.student_email ?? null}
            verification={verification}
            pendingDomainName={profile?.pending_domain_name ?? null}
          />

          <div className="space-y-2 rounded-2xl glass p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Resume
          </h2>
          {currentResume ? (
            <>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/12 text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400"
                >
                  <FileText size={17} strokeWidth={1.75} />
                </span>
                <p className="min-w-0 text-sm">
                  <span className="block truncate font-medium">
                    {currentResume.file_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Uploaded{" "}
                    {new Date(currentResume.uploaded_at).toLocaleDateString()}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <ResumePreview fileName={currentResume.file_name} />
                <Button variant="ghost" size="sm" asChild className="rounded-full">
                  <Link href="/profile/settings/resume">Replace</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No current resume.
              </p>
              <Button size="sm" asChild className="rounded-full">
                <Link href="/profile/settings/resume">Upload</Link>
              </Button>
            </>
          )}
          </div>
      </div>
    </div>
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
