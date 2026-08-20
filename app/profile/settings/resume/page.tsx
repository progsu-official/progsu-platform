import { createClient } from "@/lib/supabase/server";

import { ResumeSettings } from "../resume-settings";
import { SettingsHeader, SettingsGroup, SettingBlock } from "../_ui";

export const dynamic = "force-dynamic";

export default async function ResumeSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: currentResume } = await supabase
    .from("resumes")
    .select("id, file_name, uploaded_at")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();

  return (
    <>
      <SettingsHeader
        title="Resume"
        description="PDF only, up to 10 MB. Recruiters receive your current resume when you're included in a sponsor export."
      />
      <SettingsGroup>
        <SettingBlock>
          <ResumeSettings
            currentFileName={currentResume?.file_name ?? null}
            currentUploadedAt={currentResume?.uploaded_at ?? null}
          />
        </SettingBlock>
      </SettingsGroup>
    </>
  );
}
