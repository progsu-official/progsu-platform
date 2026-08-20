import { createClient } from "@/lib/supabase/server";

import { OpenToRecruitersToggle } from "@/app/profile/open-to-recruiters-toggle";

import { NotificationSettings } from "../notification-settings";
import { SettingsHeader } from "../_ui";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: consents }, { data: versions }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("phone_number, open_to_recruiters")
        .eq("id", user.id)
        .single(),
      supabase
        .from("consents")
        .select("consent_type, accepted, version, accepted_at, id")
        .eq("user_id", user.id),
      supabase.from("consent_versions").select("consent_type, version"),
    ]);

  return (
    <>
      <SettingsHeader
        title="Notifications"
        description="What Progsu is allowed to send you, and who your profile can be shared with."
      />
      {/* Anchors retained from the single-page layout. */}
      <span id="consents" aria-hidden className="block scroll-mt-24" />
      <span id="recruiter" aria-hidden className="block scroll-mt-24" />

      {/* Lives here rather than on the profile page: the completion band's
          "Turn on recruiter visibility" prompt disappears once it's on, so the
          off switch needs a permanent home. */}
      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recruiter exports
        </h2>
        <div className="overflow-hidden rounded-2xl glass">
          <div className="flex items-start justify-between gap-6 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Include me in recruiter exports
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Your name, profile, and current resume go out in the CSVs we
                share with sponsors. Your Progsu activity stays private.
              </p>
            </div>
            <OpenToRecruitersToggle
              initialOpen={!!profile?.open_to_recruiters}
            />
          </div>
        </div>
      </section>

      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Messages and sharing
      </h2>
      <NotificationSettings
        consents={consents ?? []}
        versions={versions ?? []}
        phoneNumber={profile?.phone_number ?? ""}
      />

      <p className="mt-4 px-1 text-xs leading-relaxed text-muted-foreground">
        These control marketing only. If you RSVP to an event you&apos;ll still
        get that event&apos;s confirmation, reminder, and cancellation notice —
        cancel the RSVP to stop those.
      </p>
    </>
  );
}
