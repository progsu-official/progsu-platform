import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getOwnVisibilitySettings } from "@/lib/actions/members";

import { VisibilitySettings } from "../visibility-settings";
import { SettingsHeader, SettingsGroup, SettingBlock } from "../_ui";

export const dynamic = "force-dynamic";

export default async function VisibilitySettingsPage() {
  // Flag off = the surface doesn't exist, matching the nav which hides the item.
  if (!env.FEATURE_MEMBER_DIRECTORY) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("discord_username, discord_user_id")
    .eq("id", user.id)
    .single();

  const result = await getOwnVisibilitySettings();
  const v = result.ok ? result.data : null;

  return (
    <>
      <SettingsHeader
        title="Visibility"
        description="Control whether other Progsu members can find your profile and what they can see about you."
      />
      <SettingsGroup>
        <SettingBlock>
          <VisibilitySettings
            initial={{
              discoverable: v?.discoverable ?? false,
              share_attended_events: v?.share_attended_events ?? false,
              share_shared_event_counts: v?.share_shared_event_counts ?? false,
              profile_slug: v?.profile_slug ?? null,
              discord_username: profile?.discord_username ?? null,
              discord_user_id: profile?.discord_user_id ?? null,
            }}
            siteUrl={env.NEXT_PUBLIC_SITE_URL}
            sharedEventsEnabled={env.FEATURE_SHARED_EVENT_HISTORY}
          />
        </SettingBlock>
      </SettingsGroup>
    </>
  );
}
