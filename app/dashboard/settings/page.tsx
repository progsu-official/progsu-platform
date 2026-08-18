import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getOwnVisibilitySettings } from "@/lib/actions/members";

import { AccountEmailSettings } from "./account-email-settings";
import { ConsentSettings } from "./consent-settings";
import { PhotoSettings } from "./photo-settings";
import { ResumeSettings } from "./resume-settings";
import { ProfileSettings } from "./profile-settings";
import { VisibilitySettings } from "./visibility-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: currentResume }, { data: domains }, { data: consents }, { data: versions }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "first_name, last_name, preferred_name, school, major, minor, class_standing, grad_year, grad_term, interested_roles, linkedin_url, github_url, portfolio_url, phone_number, google_email, student_email, student_email_verified, student_email_verified_at, pending_domain_name, avatar_url"
        )
        .eq("id", user.id)
        .single(),
      supabase
        .from("resumes")
        .select("id, file_name, uploaded_at")
        .eq("user_id", user.id)
        .eq("is_current", true)
        .maybeSingle(),
      supabase
        .from("school_domains")
        .select("school_name")
        .eq("is_active", true)
        .order("school_name"),
      supabase
        .from("consents")
        .select("consent_type, accepted, version, accepted_at, id")
        .eq("user_id", user.id),
      supabase.from("consent_versions").select("consent_type, version"),
    ]);

  const schoolOptions = Array.from(
    new Set((domains ?? []).map((d) => d.school_name))
  );

  let visibility: {
    discoverable: boolean;
    share_attended_events: boolean;
    share_shared_event_counts: boolean;
    profile_slug: string | null;
  } | null = null;
  if (env.FEATURE_MEMBER_DIRECTORY) {
    const r = await getOwnVisibilitySettings();
    if (r.ok) {
      visibility = r.data ?? {
        discoverable: false,
        share_attended_events: false,
        share_shared_event_counts: false,
        profile_slug: null,
      };
    }
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Update your profile, replace your resume, or change your marketing
          preferences.
        </p>
      </header>

      <section id="account-email" className="space-y-4">
        <h2 className="text-xl font-semibold">Account email</h2>
        <p className="text-sm text-muted-foreground">
          Your sign-in email and your school email. Verifying your school email
          unlocks recruiter visibility once your profile is complete.
        </p>
        <AccountEmailSettings
          googleEmail={(profile?.google_email as string | undefined) ?? ""}
          studentEmail={(profile?.student_email as string | null | undefined) ?? null}
          studentEmailVerified={!!profile?.student_email_verified}
          studentEmailVerifiedAt={
            (profile?.student_email_verified_at as string | null | undefined) ?? null
          }
          pendingDomainName={
            (profile?.pending_domain_name as string | null | undefined) ?? null
          }
        />
      </section>

      <section id="photo" className="space-y-4 scroll-mt-24">
        <h2 className="text-xl font-semibold">Profile photo</h2>
        <PhotoSettings
          currentAvatarUrl={(profile?.avatar_url as string | null | undefined) ?? null}
          displayName={profile?.preferred_name || profile?.first_name || "You"}
        />
      </section>

      <section id="profile" className="space-y-4">
        {/* Anchor targets for the dashboard profile-completion ring
            (docs/14-low-friction-signup §3). The form is one component so
            these empty anchors live at the page level; scroll-margin makes
            the jump land below the site header instead of under it. */}
        <span
          id="verify-email"
          aria-hidden
          className="block scroll-mt-24"
        />
        <span id="academic" aria-hidden className="block scroll-mt-24" />
        <span id="roles" aria-hidden className="block scroll-mt-24" />
        <span id="recruiter" aria-hidden className="block scroll-mt-24" />
        <span id="links" aria-hidden className="block scroll-mt-24" />
        <h2 className="text-xl font-semibold">Profile</h2>
        <ProfileSettings
          initial={{
            firstName: profile?.first_name ?? "",
            lastName: profile?.last_name ?? "",
            preferredName: profile?.preferred_name ?? "",
            school: profile?.school ?? "",
            major: profile?.major ?? "",
            minor: profile?.minor ?? "",
            classStanding: profile?.class_standing ?? "",
            gradYear: profile?.grad_year ?? null,
            gradTerm: profile?.grad_term?.split(" ")[0] ?? "",
            interestedRoles: profile?.interested_roles ?? [],
            linkedinUrl: profile?.linkedin_url ?? "",
            githubUrl: profile?.github_url ?? "",
            portfolioUrl: profile?.portfolio_url ?? "",
            phoneNumber: profile?.phone_number ?? "",
          }}
          schoolOptions={schoolOptions}
        />
      </section>

      <section id="resume" className="space-y-4">
        <h2 className="text-xl font-semibold">Resume</h2>
        <ResumeSettings
          currentFileName={currentResume?.file_name ?? null}
          currentUploadedAt={currentResume?.uploaded_at ?? null}
        />
      </section>

      <section id="consents" className="space-y-4">
        <h2 className="text-xl font-semibold">Marketing preferences</h2>
        <p className="text-sm text-muted-foreground">
          These toggles only affect marketing messages. If you RSVP to an
          event, you may still receive a confirmation, reminder, and
          cancellation notice for that event regardless of these settings.
          To stop those, cancel your RSVP.
        </p>
        <ConsentSettings
          consents={consents ?? []}
          versions={versions ?? []}
          phoneNumber={profile?.phone_number ?? ""}
        />
      </section>

      {visibility ? (
        <section id="visibility" className="space-y-4">
          <h2 className="text-xl font-semibold">Profile visibility</h2>
          <p className="text-sm text-muted-foreground">
            Control whether other Progsu members can find your profile and
            what they can see about you.
          </p>
          <VisibilitySettings
            initial={visibility}
            siteUrl={env.NEXT_PUBLIC_SITE_URL}
            sharedEventsEnabled={env.FEATURE_SHARED_EVENT_HISTORY}
          />
        </section>
      ) : null}
    </div>
  );
}
