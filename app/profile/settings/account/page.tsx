import { createClient } from "@/lib/supabase/server";

import { AccountEmailSettings } from "../account-email-settings";
import { SettingsHeader, SettingsGroup, SettingBlock } from "../_ui";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "google_email, student_email, student_email_verified, student_email_verified_at, pending_domain_name"
    )
    .eq("id", user.id)
    .single();

  return (
    <>
      <SettingsHeader
        title="Account"
        description="Your sign-in email and your school email. Verifying your school email unlocks recruiter visibility once your profile is complete."
      />
      {/* Anchor retained from the single-page layout. */}
      <span id="verify-email" aria-hidden className="block scroll-mt-24" />
      <SettingsGroup>
        <SettingBlock>
          <AccountEmailSettings
            googleEmail={profile?.google_email ?? user.email ?? ""}
            studentEmail={profile?.student_email ?? null}
            studentEmailVerified={!!profile?.student_email_verified}
            studentEmailVerifiedAt={profile?.student_email_verified_at ?? null}
            pendingDomainName={profile?.pending_domain_name ?? null}
          />
        </SettingBlock>
      </SettingsGroup>
    </>
  );
}
