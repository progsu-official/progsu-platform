import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { Button } from "@/components/ui/button";

import { OpenToRecruitersToggle } from "./open-to-recruiters-toggle";
import { StaleConsentBanner } from "./stale-consent-banner";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "first_name, last_name, preferred_name, school, major, grad_year, grad_term, class_standing, student_email, student_email_verified, pending_domain_name, open_to_recruiters, interested_roles"
    )
    .eq("id", user.id)
    .single();

  const { data: currentResume } = await supabase
    .from("resumes")
    .select("id, file_name, uploaded_at")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();

  const [{ data: consents }, { data: versions }, upcomingResult] =
    await Promise.all([
      supabase
        .from("consents")
        .select("consent_type, accepted, version, accepted_at, id")
        .eq("user_id", user.id),
      supabase.from("consent_versions").select("consent_type, version"),
      env.FEATURE_EVENTS
        ? supabase
            .from("self_event_history")
            .select("event_id, slug, title, starts_at, rsvp_status")
            .gte("starts_at", new Date().toISOString())
            .in("rsvp_status", ["going", "waitlisted"])
            .order("starts_at", { ascending: true })
            .limit(3)
        : Promise.resolve({ data: null }),
    ]);
  const upcomingPlans = upcomingResult.data;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome, {profile?.preferred_name || profile?.first_name}.
        </h1>
        <p className="text-sm text-muted-foreground">
          Your Progsu member profile at a glance.
        </p>
      </header>

      <StaleConsentBanner consents={consents ?? []} versions={versions ?? []} />

      {!profile?.student_email_verified ? (
        profile?.pending_domain_name ? (
          <section className="flex items-start justify-between gap-4 rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
            <div>
              <p className="font-medium text-foreground">
                {profile.pending_domain_name} is coming soon
              </p>
              <p className="mt-1 text-muted-foreground">
                Your school isn&apos;t on our verification list yet. Once we
                add it you&apos;ll be prompted to verify. Until then recruiters
                won&apos;t see your profile. You can swap to a different school
                email any time.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/onboarding/verify-email">Change email</Link>
            </Button>
          </section>
        ) : (
          <section className="flex items-start justify-between gap-4 rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-500/10">
            <div>
              <p className="font-medium text-foreground">
                Your student email isn&apos;t verified
              </p>
              <p className="mt-1 text-muted-foreground">
                You can still use Progsu, but recruiters will only see members
                with a verified school email. Verify any time from below.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/onboarding/verify-email">Verify now</Link>
            </Button>
          </section>
        )
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-md border p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Profile
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
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
                  className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
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
                  className="ml-1 inline-flex shrink-0 items-center rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 cursor-help"
                >
                  {profile.pending_domain_name ? "School coming soon" : "Unverified"}
                </span>
              ) : null}
            </dd>
          </dl>
          <div className="pt-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/settings">Edit</Link>
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-md border p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Resume</h2>
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
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/settings#resume">Replace</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No current resume.
              </p>
              <Button size="sm" asChild>
                <Link href="/dashboard/settings#resume">Upload</Link>
              </Button>
            </>
          )}
        </div>
      </section>

      {env.FEATURE_EVENTS ? (
        <UpcomingEventsCard rows={upcomingPlans ?? []} />
      ) : null}

      <section className="rounded-md border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">
              Recruiter visibility
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              When on, Progsu can include you in CSV exports we share with
              sponsors. Your name, profile, and current resume go out; your
              Progsu dashboard stays private.
            </p>
          </div>
          <OpenToRecruitersToggle
            initialOpen={!!profile?.open_to_recruiters}
          />
        </div>
      </section>
    </div>
  );
}

type UpcomingPlanRow = {
  event_id: string;
  slug: string;
  title: string;
  starts_at: string;
  rsvp_status: string | null;
};

function UpcomingEventsCard({ rows }: { rows: Array<Record<string, unknown>> }) {
  const plans: UpcomingPlanRow[] = rows.map((r) => ({
    event_id: r.event_id as string,
    slug: r.slug as string,
    title: r.title as string,
    starts_at: r.starts_at as string,
    rsvp_status: (r.rsvp_status as string | null) ?? null,
  }));

  return (
    <section className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Upcoming events</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your next Progsu plans.
          </p>
        </div>
        <Link
          href="/events?tab=my-plans"
          className="text-xs text-primary underline underline-offset-4"
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
        <ul className="mt-3 divide-y rounded-md border">
          {plans.map((p) => (
            <li
              key={p.event_id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <Link
                  href={`/events/${p.slug}`}
                  className="block truncate text-sm font-medium text-foreground hover:text-primary"
                >
                  {p.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {new Date(p.starts_at).toLocaleString()}
                </p>
              </div>
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                  (p.rsvp_status === "going"
                    ? "bg-primary/10 text-primary"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400")
                }
              >
                {p.rsvp_status === "going" ? "Going" : "Waitlisted"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
