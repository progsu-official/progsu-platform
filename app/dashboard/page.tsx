import Link from "next/link";
import { CalendarDays } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { resolveCoverUrls } from "@/lib/events/cover-url";
import { loadProfileCompletion } from "@/lib/auth/profile-completion";
import { Button } from "@/components/ui/button";

import { OpenToRecruitersToggle } from "./open-to-recruiters-toggle";
import { ProfileCompletionRing } from "./profile-completion-ring";
import { StaleConsentBanner } from "./stale-consent-banner";

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
      "first_name, last_name, preferred_name, school, major, grad_year, grad_term, class_standing, student_email, student_email_verified, pending_domain_name, open_to_recruiters, interested_roles, avatar_url, linkedin_url, github_url, created_at"
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
  if (upcomingPlans && upcomingPlans.length > 0) {
    const paths = (upcomingPlans as Array<{ cover_image_path: string | null }>).map(
      (r) => r.cover_image_path ?? null
    );
    upcomingCoverUrls = await resolveCoverUrls(supabase, paths);

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

  const displayName = [
    profile?.preferred_name || profile?.first_name,
    profile?.last_name,
  ]
    .filter(Boolean)
    .join(" ");
  const subline = [profile?.school, profile?.major].filter(Boolean).join(" · ");
  const joined = profile?.created_at
    ? joinedFormatter.format(new Date(profile.created_at))
    : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="h-24 w-24 shrink-0 rounded-full border border-border object-cover shadow-lg shadow-black/30"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-2xl font-semibold uppercase text-muted-foreground"
          >
            {(displayName || "?").charAt(0)}
          </div>
        )}
        <div className="min-w-0 space-y-2">
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
      </header>

      <StaleConsentBanner consents={consents ?? []} versions={versions ?? []} />

      <ProfileCompletionRing completion={completion} />

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

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-2xl border border-border/70 bg-card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Profile
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd>
              {profile?.first_name} {profile?.last_name}
            </dd>
            <dt className="text-muted-foreground">School</dt>
            <dd>{profile?.school}</dd>
            <dt className="text-muted-foreground">Major</dt>
            <dd>{profile?.major}</dd>
            <dt className="text-muted-foreground">Class</dt>
            <dd>{profile?.class_standing}</dd>
            <dt className="text-muted-foreground">Graduates</dt>
            <dd>{profile?.grad_term}</dd>
            <dt className="text-muted-foreground">Student email</dt>
            <dd className="flex items-center gap-1 truncate">
              <span className="truncate">
                {profile?.student_email ?? (
                  <span className="text-muted-foreground">not set</span>
                )}
              </span>
              {profile?.student_email_verified ? (
                <span
                  title="Verified via OTP"
                  aria-label="Verified"
                  className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                >
                  ✓ Verified
                </span>
              ) : profile?.student_email ? (
                <span
                  title={
                    profile.pending_domain_name
                      ? `${profile.pending_domain_name} isn't on our verification list yet — we'll enable it soon.`
                      : "Waiting for you to verify via OTP. Recruiters won't see your profile until then."
                  }
                  className="ml-1 inline-flex shrink-0 cursor-help items-center rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                >
                  {profile.pending_domain_name ? "School coming soon" : "Unverified"}
                </span>
              ) : null}
            </dd>
          </dl>
          <div className="pt-2">
            <Button variant="outline" size="sm" asChild className="rounded-full">
              <Link href="/dashboard/settings">Edit</Link>
            </Button>
          </div>
        </div>

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
      </section>

      {env.FEATURE_EVENTS ? (
        <UpcomingEventsCard
          rows={upcomingPlans ?? []}
          coverUrls={upcomingCoverUrls}
          waitlistPositions={upcomingWaitlistPositions}
        />
      ) : null}

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
    </div>
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

type UpcomingPlanRow = {
  event_id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  location_text: string | null;
  rsvp_status: string | null;
};

function UpcomingEventsCard({
  rows,
  coverUrls,
  waitlistPositions,
}: {
  rows: Array<Record<string, unknown>>;
  coverUrls: Array<string | null>;
  waitlistPositions: Map<string, number | null>;
}) {
  const plans: UpcomingPlanRow[] = rows.map((r) => ({
    event_id: r.event_id as string,
    slug: r.slug as string,
    title: r.title as string,
    starts_at: r.starts_at as string,
    ends_at: r.ends_at as string,
    status: (r.status as string) ?? "published",
    location_text: (r.location_text as string | null) ?? null,
    rsvp_status: (r.rsvp_status as string | null) ?? null,
  }));

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Upcoming events</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your next Progsu plans.
          </p>
        </div>
        <Link
          href="/events?tab=my-plans"
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          See all →
        </Link>
      </div>

      {plans.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No upcoming events.{" "}
          <Link
            href="/events"
            className="text-primary underline underline-offset-4"
          >
            Browse events
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {plans.map((p, i) => {
            const cover = coverUrls[i] ?? null;
            const cancelled = p.status === "cancelled";
            const isWaitlisted = p.rsvp_status === "waitlisted";
            const position = isWaitlisted
              ? waitlistPositions.get(p.event_id) ?? null
              : null;
            return (
              <li key={p.event_id} className="flex items-center gap-3 py-2.5">
                <div
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-muted to-primary/20"
                  aria-hidden
                >
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/events/${p.slug}`}
                    className="block truncate text-sm font-medium text-foreground hover:text-primary"
                  >
                    {p.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(p.starts_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {p.location_text ? ` · ${p.location_text}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                      (cancelled
                        ? "bg-destructive/15 text-destructive"
                        : p.rsvp_status === "going"
                          ? "bg-primary/15 text-primary"
                          : "bg-amber-400/15 text-amber-300")
                    }
                  >
                    {cancelled
                      ? "Cancelled"
                      : p.rsvp_status === "going"
                        ? "Going"
                        : "Waitlisted"}
                  </span>
                  {isWaitlisted && position != null ? (
                    <span className="text-[10px] text-muted-foreground">
                      #{position}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
