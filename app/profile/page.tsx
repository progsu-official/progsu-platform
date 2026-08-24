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
import { AttendedEvents } from "./attended-events";
import { EducationCard, type VerificationState } from "./education-card";
import { ResumePreview } from "./resume-preview";
import { AvatarButton } from "./avatar-button";
import { ProfileBanner } from "./profile-banner";
import { NoteBubble } from "./note-bubble";
import { SchoolLogo } from "./school-logo";
import { MyCheckinQr } from "./my-checkin-qr";
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
      "first_name, last_name, preferred_name, school, major, major_other_text, minor, grad_year, grad_term, class_standing, student_email, student_email_verified, pending_domain_name, open_to_recruiters, interested_roles, avatar_url, linkedin_url, github_url, created_at"
    )
    .eq("id", user.id)
    .single();

  // note and banner_url are queried apart from the row above, and failure is
  // swallowed on purpose. They arrive in 20260820130000; until that migration
  // runs, PostgREST rejects the whole select for an unknown column. Folded
  // into the main query that took the entire profile down with it -- name,
  // school, links, everything -- because two optional decorations were
  // missing. A surface nobody has migrated yet should degrade to "no banner",
  // not to "no profile".
  const { data: decorations } = await supabase
    .from("profiles")
    .select("note, banner_url, checkin_code")
    .eq("id", user.id)
    .maybeSingle();
  const note = (decorations as { note?: string | null } | null)?.note ?? null;
  const bannerUrl =
    (decorations as { banner_url?: string | null } | null)?.banner_url ?? null;
  const checkinCode =
    (decorations as { checkin_code?: string | null } | null)?.checkin_code ??
    null;

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
    attendedListResult,
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
          .select("event_id, slug, title, starts_at, ends_at, location_text, cover_image_path")
          .eq("attended", true)
          .order("starts_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null }),
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
  const attendedList = attendedListResult.data ?? [];
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

  const attendedCoverUrls =
    attendedList.length > 0
      ? await resolveCoverUrls(
          supabase,
          (attendedList as Array<{ cover_image_path: string | null }>).map(
            (r) => r.cover_image_path ?? null
          )
        )
      : [];

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
  // School moved to the header's right rail, so the subline under the name
  // is the degree alone rather than repeating the institution.
  const subline = majorLabel;
  const joined = profile?.created_at
    ? joinedFormatter.format(new Date(profile.created_at))
    : null;

  return (
    <div className="space-y-8">
      <div>
        <ProfileBanner bannerUrl={bannerUrl} />

      {/* Only the avatar column is pulled up over the banner. Pulling the
          whole header up and bottom-aligning it dragged the name, subline and
          stats into the banner's bottom edge — the identity text belongs on
          the page's own background, where it reads against a known surface
          instead of whatever image the member uploaded. relative+z-10 is
          required, not cosmetic: the banner is positioned, this header is
          not, so without a stacking context of its own the banner paints on
          top and swallows clicks meant for the controls in the overlap. */}
      <header className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
        {/* Wrapped with the mobile "Edit profile" so that button sits right
            under the banner, at the top of the stack, instead of after all
            the identity text below -- the sm:hidden pair further down
            re-shows it beside the school on desktop, where it isn't
            competing with the banner's own hover controls. */}
        <div className="flex w-full items-start justify-between gap-3 sm:w-auto sm:contents">
          <div className="group/avatar relative -mt-16 shrink-0 self-start sm:-mt-20">
            {/* self-start: without it this column stretches to the full-width
                row (flex-col's default align-items: stretch on mobile, before
                sm:items-start kicks in), so the ring wrapper below stops being
                a circle and the note above stops centering on the actual
                avatar. */}
            {/* z-20 beats the avatar button's own `relative`: both are in this
                stacking context, the button comes later in the DOM, so without
                an explicit z the bubble's tail painted underneath the avatar. */}
            <div className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2">
              <NoteBubble note={note} />
            </div>
            <div className="rounded-full ring-4 ring-background">
              <AvatarButton
                avatarUrl={profile?.avatar_url ?? null}
                displayName={displayName || "?"}
              />
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="mt-1 shrink-0 rounded-full sm:hidden">
            <Link href="/profile/settings">Edit profile</Link>
          </Button>
        </div>
        <div className="min-w-0 flex-1 space-y-2 sm:pt-2">
          {/* Marks sit on the name line rather than in a row of their own:
              two 17px glyphs did not earn a fourth band in the header, and
              beside the name they read as part of the identity. Each gets a
              44px parent per the hit-target rule, pulled back in with a
              negative margin so the padding buys reach without airing out
              the line. */}
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="truncate text-3xl font-bold tracking-tight">
              {displayName || "Member"}
            </h1>
            {profile?.linkedin_url || profile?.github_url ? (
              <div className="flex shrink-0 items-center">
                {profile.linkedin_url ? (
                  <a
                    href={profile.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="LinkedIn"
                    className="-mx-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    className="-mx-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <GitHubMark className="h-[17px] w-[17px]" />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          {subline ? (
            <p className="truncate text-sm text-muted-foreground">{subline}</p>
          ) : null}
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
        </div>

        {/* Right rail. The school moves out of the subline and into its own
            block so the identity column carries the person and this carries
            the institution -- the same split LinkedIn uses for the current
            company. Edit profile rides above it rather than beside the name:
            with the school on the right, a button there made two competing
            right-hand anchors on one line. It stays out of the banner overlap
            either way, where it would fight the banner's own hover controls
            for the same pixels. */}
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end sm:pt-2">
          <Button asChild size="sm" variant="outline" className="hidden rounded-full sm:inline-flex">
            <Link href="/profile/settings">Edit profile</Link>
          </Button>
          {profile?.school ? (
            <div className="flex max-w-56 items-center gap-2.5">
              <SchoolLogo name={profile.school} />
              <p className="min-w-0 text-sm font-semibold leading-snug">
                {profile.school}
              </p>
            </div>
          ) : null}
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

      {checkinCode ? <MyCheckinQr code={checkinCode} /> : null}

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

      {env.FEATURE_EVENTS && attendedList.length > 0 ? (
        <section aria-labelledby="attended-events-heading" className="space-y-4">
          <h2 id="attended-events-heading" className="text-sm font-semibold text-foreground">
            Events attended
          </h2>
          <AttendedEvents
            events={(
              attendedList as Array<{
                event_id: string;
                slug: string;
                title: string;
                starts_at: string;
                ends_at: string;
                location_text: string | null;
              }>
            ).map((r) => ({
              event_id: r.event_id,
              slug: r.slug,
              title: r.title,
              starts_at: r.starts_at,
              ends_at: r.ends_at,
              location_text: r.location_text,
            }))}
            coverUrls={attendedCoverUrls}
          />
        </section>
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
