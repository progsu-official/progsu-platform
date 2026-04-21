import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
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
      "first_name, last_name, preferred_name, school, major, grad_year, grad_term, class_standing, student_email, open_to_recruiters, interested_roles"
    )
    .eq("id", user.id)
    .single();

  const { data: currentResume } = await supabase
    .from("resumes")
    .select("id, file_name, uploaded_at")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();

  const [{ data: consents }, { data: versions }] = await Promise.all([
    supabase
      .from("consents")
      .select("consent_type, accepted, version, accepted_at, id")
      .eq("user_id", user.id),
    supabase.from("consent_versions").select("consent_type, version"),
  ]);

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
            <dd className="truncate">{profile?.student_email}</dd>
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
