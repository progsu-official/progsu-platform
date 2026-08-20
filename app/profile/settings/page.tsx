import { createClient } from "@/lib/supabase/server";

import { PhotoSettings } from "./photo-settings";
import { ProfileSettings } from "./profile-settings";
import { SettingsHeader, SettingsGroup, SettingBlock } from "./_ui";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: domains }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "first_name, last_name, preferred_name, school, major, minor, class_standing, grad_year, grad_term, interested_roles, linkedin_url, github_url, portfolio_url, bio, phone_number, avatar_url"
      )
      .eq("id", user.id)
      .single(),
    supabase
      .from("school_domains")
      .select("school_name")
      .eq("is_active", true)
      .order("school_name"),
  ]);

  const schoolOptions = Array.from(
    new Set((domains ?? []).map((d) => d.school_name))
  );

  return (
    <>
      <SettingsHeader title="Profile" />

      <div id="photo" className="scroll-mt-24">
        <SettingsGroup title="Photo">
          <SettingBlock>
            <PhotoSettings
              currentAvatarUrl={profile?.avatar_url ?? null}
              displayName={
                profile?.preferred_name || profile?.first_name || "You"
              }
            />
          </SettingBlock>
        </SettingsGroup>
      </div>

      {/* Anchors kept from the old single-page layout so completion-band deep
          links land on the right block instead of the top of the page. */}
      <span id="academic" aria-hidden className="block scroll-mt-24" />
      <span id="roles" aria-hidden className="block scroll-mt-24" />
      <span id="links" aria-hidden className="block scroll-mt-24" />

      <SettingsGroup title="Details">
        <SettingBlock>
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
              bio: profile?.bio ?? "",
              phoneNumber: profile?.phone_number ?? "",
            }}
            schoolOptions={schoolOptions}
          />
        </SettingBlock>
      </SettingsGroup>
    </>
  );
}
