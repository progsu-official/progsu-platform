import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { resolveCoverUrls } from "@/lib/events/cover-url";
import { CLASS_STANDING_LABELS } from "@/lib/enums/roles";
import {
  getMemberCardBySlug,
  getSharedEventsForViewer,
  getUpcomingEventsForViewer,
} from "@/lib/actions/members";
import { getCurrentResumeInfoForViewer } from "@/lib/actions/resume";
import { Avatar } from "@/app/_components/avatar";
import { StaticBanner } from "@/app/profile/profile-banner";
import { StaticNote } from "@/app/profile/note-bubble";
import { StaticEducationCard, type VerificationState } from "@/app/profile/education-card";
import { SchoolLogo } from "@/app/profile/school-logo";
import { ResumePreview } from "@/app/profile/resume-preview";
import { UpcomingEvents, type UpcomingPlan } from "@/app/profile/upcoming-events";
import { AttendedEvents } from "@/app/profile/attended-events";

export const dynamic = "force-dynamic";

// Explicitly no OG/Twitter meta generation: cards are authenticated-only, so
// link previews in chat apps shouldn't try to fetch the page anonymously.
export const metadata = {
  title: "Member · Progsu",
  robots: { index: false, follow: false },
};

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const result = await getMemberCardBySlug(slug);
  if (!result.ok) {
    // Either unauthenticated (shouldn't reach here — middleware bounces) or
    // an internal error. Surface a neutral 404 so we don't leak slug existence.
    notFound();
  }
  if (!result.data) notFound();

  const { card, attendedEvents } = result.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isSelf = user?.id === card.user_id;
  // Your own slug is the public card peers see, not the editable dashboard —
  // send you to the real thing instead of a read-only mirror of yourself.
  if (isSelf) redirect("/profile");

  // Shared-events section: only when flag is on AND viewing a peer (not self).
  // Action wrapper handles the flag; this is a belt-and-suspenders check so we
  // also skip the RPC round-trip on self-views.
  const sharedEvents =
    env.FEATURE_SHARED_EVENT_HISTORY && user?.id && !isSelf
      ? await getSharedEventsForViewer(card.user_id).then((r) =>
          r.ok ? r.data : null
        )
      : null;

  const [upcomingResult, resumeInfoResult] = await Promise.all([
    getUpcomingEventsForViewer(card.user_id),
    getCurrentResumeInfoForViewer(card.user_id),
  ]);
  const upcomingRows = upcomingResult.ok ? upcomingResult.data : [];
  const resumeInfo = resumeInfoResult.ok ? resumeInfoResult.data : null;

  const upcomingPlans: UpcomingPlan[] = upcomingRows.map((r) => ({
    event_id: r.event_id,
    slug: r.slug,
    title: r.title,
    starts_at: r.starts_at,
    status: r.status,
    location_text: r.location_text,
    rsvp_status: r.rsvp_status,
  }));
  const upcomingCoverUrls =
    upcomingRows.length > 0
      ? await resolveCoverUrls(
          supabase,
          upcomingRows.map((r) => r.cover_image_path)
        )
      : [];
  const upcomingGoingCounts = new Map(
    upcomingRows.map((r) => [r.event_id, r.going_count])
  );
  const attendedCoverUrls =
    attendedEvents.length > 0
      ? await resolveCoverUrls(
          supabase,
          attendedEvents.map((ev) => ev.cover_image_path)
        )
      : [];

  // profiles.major holds a slug from the majors table; resolve it to its
  // label so the card doesn't render "computer_information_systems". Legacy
  // rows predate the table and hold free text, which falls through unchanged.
  let majorLabel = card.major;
  if (card.major) {
    const { data: majorRow } = await supabase
      .from("majors")
      .select("label")
      .eq("slug", card.major)
      .maybeSingle();
    if (majorRow?.label) majorLabel = majorRow.label;
  }
  const degreeLine =
    [majorLabel, card.minor ? `Minor in ${card.minor}` : null]
      .filter(Boolean)
      .join(" · ") || null;
  const standingLine =
    [
      card.class_standing
        ? CLASS_STANDING_LABELS[
            card.class_standing as keyof typeof CLASS_STANDING_LABELS
          ] ?? card.class_standing
        : null,
      card.grad_term ? `Graduates ${card.grad_term}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;
  const verification: VerificationState = card.student_email_verified
    ? "verified"
    : !card.has_student_email
      ? "none"
      : card.pending_domain_name
        ? "pending_domain"
        : "unverified";

  const gradLabel =
    card.grad_term && card.grad_year
      ? `${card.grad_term}`
      : card.grad_year
        ? `Class of ${card.grad_year}`
        : null;

  return (
    <div className="space-y-8">
      <nav>
        <Link
          href="/members"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={15} aria-hidden />
          All members
        </Link>
      </nav>

      <div>
        <StaticBanner bannerUrl={card.banner_url} />

        {/* Mirrors the owner's own header (app/profile/page.tsx) — same
            avatar overlap/size, centered note bubble, socials on the name
            line, school in a right rail — minus the owner-only controls
            (no AvatarButton, no Edit profile button). */}
        <header className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
          <div className="relative -mt-16 shrink-0 sm:-mt-20">
            {card.note ? (
              <div className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2">
                <StaticNote note={card.note} />
              </div>
            ) : null}
            <div className="rounded-full ring-4 ring-background">
              <Avatar
                src={card.avatar_url}
                name={card.display_name ?? "?"}
                className="h-32 w-32 rounded-full shadow-lg shadow-black/10 dark:shadow-black/30 sm:h-40 sm:w-40"
                textClassName="text-3xl"
              />
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-2 sm:pt-2">
            <div className="flex min-w-0 items-center gap-1">
              <h1 className="truncate text-3xl font-bold tracking-tight">
                {card.display_name ?? "Member"}
              </h1>
              {card.linkedin_url || card.github_url ? (
                <div className="flex shrink-0 items-center">
                  {card.linkedin_url ? (
                    <a
                      href={card.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="LinkedIn"
                      title={linkPreview(card.linkedin_url)}
                      className="-mx-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <LinkedInIcon className="h-[17px] w-[17px]" />
                    </a>
                  ) : null}
                  {card.github_url ? (
                    <a
                      href={card.github_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="GitHub"
                      title={linkPreview(card.github_url)}
                      className="-mx-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <GitHubIcon className="h-[17px] w-[17px]" />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            {card.school || card.class_standing || gradLabel ? (
              <p className="truncate text-sm text-muted-foreground">
                {[
                  card.school,
                  card.class_standing
                    ? card.class_standing[0].toUpperCase() +
                      card.class_standing.slice(1)
                    : null,
                  gradLabel,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {card.bio ? <p className="text-sm">{card.bio}</p> : null}
            {card.portfolio_url ? (
              <a
                href={card.portfolio_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Portfolio"
                title={linkPreview(card.portfolio_url)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                <Globe size={15} strokeWidth={1.75} aria-hidden />
                {linkPreview(card.portfolio_url)}
              </a>
            ) : null}
          </div>

          {card.school ? (
            <div className="flex shrink-0 items-center gap-2.5 sm:pt-2">
              <SchoolLogo name={card.school} />
              <p className="min-w-0 max-w-56 text-sm font-semibold leading-snug">
                {card.school}
              </p>
            </div>
          ) : null}
        </header>
      </div>

      {env.FEATURE_PUBLIC_PROFILE_EVENTS && upcomingPlans.length > 0 ? (
        <UpcomingEvents
          plans={upcomingPlans}
          coverUrls={upcomingCoverUrls}
          waitlistPositions={new Map()}
          goingCounts={upcomingGoingCounts}
          seeAllHref={null}
        />
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <StaticEducationCard
          school={card.school}
          degreeLine={degreeLine}
          standingLine={standingLine}
          verification={verification}
          pendingDomainName={card.pending_domain_name}
        />

        {env.FEATURE_PUBLIC_PROFILE_RESUME ? (
          <div className="space-y-2 rounded-2xl glass p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Resume
            </h2>
            {resumeInfo ? (
              <>
                <p className="min-w-0 truncate text-sm font-medium">
                  {resumeInfo.fileName}
                </p>
                <ResumePreview
                  fileName={resumeInfo.fileName}
                  targetUserId={card.user_id}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No resume shared.</p>
            )}
          </div>
        ) : null}
      </div>

      <section className="rounded-2xl border border-border/70 bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Interested in
        </h2>
        {card.interested_roles && card.interested_roles.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {card.interested_roles.map((role) => (
              <li
                key={role}
                className="rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs capitalize"
              >
                {role.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing listed yet.
          </p>
        )}
      </section>

      {card.share_attended_events ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Events attended
          </h2>
          <AttendedEvents
            events={attendedEvents.map((ev) => ({
              event_id: ev.event_id,
              slug: ev.event_slug,
              title: ev.event_title,
              starts_at: ev.starts_at,
            }))}
            coverUrls={attendedCoverUrls}
          />
        </section>
      ) : null}

      {sharedEvents && sharedEvents.aggregate_count > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Shared events with you
          </h2>
          {sharedEvents.named_events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You and {card.display_name ?? "this member"} have attended{" "}
              {sharedEvents.aggregate_count} shared{" "}
              {sharedEvents.aggregate_count === 1 ? "event" : "events"}.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card">
                {sharedEvents.named_events.map((ev) => (
                  <li
                    key={ev.event_id}
                    className="flex items-center justify-between gap-4 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/events/${ev.event_slug}`}
                        className="truncate text-sm font-medium hover:text-primary"
                      >
                        {ev.event_title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {new Date(ev.starts_at).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {sharedEvents.named_events.length < sharedEvents.aggregate_count ? (
                <p className="text-xs text-muted-foreground">
                  Plus{" "}
                  {sharedEvents.aggregate_count -
                    sharedEvents.named_events.length}{" "}
                  more shared{" "}
                  {sharedEvents.aggregate_count -
                    sharedEvents.named_events.length ===
                  1
                    ? "event"
                    : "events"}{" "}
                  that aren&apos;t shown here.
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

// Strips scheme + trailing slash for a compact hover-tooltip preview, e.g.
// "linkedin.com/in/devmember" instead of the full https:// URL.
function linkPreview(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// lucide-react dropped brand/logo icons; these are the standard Simple Icons
// brand paths, inlined rather than pulling in a whole icon package for two marks.
function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
