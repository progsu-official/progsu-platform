import { adminClient } from "./session";

// Seed helpers for E2E tests. Mirror the well-tested "fully onboarded user"
// pattern from scripts/smoke-event-rsvp.ts so every fixture user satisfies
// is_fully_onboarded() on first login. Always reads consent_versions at the
// start so a future privacy_policy bump doesn't silently invalidate seeds.

export const E2E_PASSWORD = "e2e-testpassword-12345";

let cachedVersions: Map<string, string> | null = null;

async function getConsentVersions(): Promise<Map<string, string>> {
  if (cachedVersions) return cachedVersions;
  const admin = adminClient();
  const { data, error } = await admin
    .from("consent_versions")
    .select("consent_type, version");
  if (error) throw new Error(`consent_versions: ${error.message}`);
  cachedVersions = new Map(
    (data ?? []).map((r) => [r.consent_type as string, r.version as string])
  );
  return cachedVersions;
}

export type SeedUserOpts = {
  firstName?: string;
  lastName?: string;
};

export async function makeAdminUser(
  email: string,
  _opts: SeedUserOpts = {}
): Promise<{ id: string }> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`makeAdminUser ${email}: ${error?.message}`);
  }
  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      is_admin: true,
      first_name: "Admin",
      last_name: "E2E",
    })
    .eq("id", data.user.id);
  if (profileErr) {
    throw new Error(`admin profile update ${email}: ${profileErr.message}`);
  }
  return { id: data.user.id };
}

export async function makeFullyOnboardedUser(
  email: string,
  opts: SeedUserOpts = {}
): Promise<{ id: string }> {
  const admin = adminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`makeFullyOnboardedUser ${email}: ${error?.message}`);
  }
  const uid = data.user.id;

  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      first_name: opts.firstName ?? "Member",
      last_name: opts.lastName ?? "E2E",
      school: "Georgia State University",
      major: "Computer Science",
      class_standing: "junior",
      grad_year: 2027,
      grad_term: "Spring 2027",
      interested_roles: ["software_engineering"],
      phone_number: "555-555-5555",
    })
    .eq("id", uid);
  if (profileErr) {
    throw new Error(`profile update ${email}: ${profileErr.message}`);
  }

  const versions = await getConsentVersions();
  const ts = new Date().toISOString();
  const { error: consentErr } = await admin.from("consents").insert(
    ["privacy_policy", "terms_of_service", "age_confirmation"].map((t) => ({
      user_id: uid,
      consent_type: t,
      accepted: true,
      version: versions.get(t) ?? "v1",
      accepted_at: ts,
    }))
  );
  if (consentErr) {
    throw new Error(`consents insert ${email}: ${consentErr.message}`);
  }

  const { error: resumeErr } = await admin.from("resumes").insert({
    user_id: uid,
    storage_path: `${uid}/e2e-${Date.now()}.pdf`,
    file_name: "e2e-resume.pdf",
    file_size: 1024,
    mime_type: "application/pdf",
    status: "active",
    is_current: true,
  });
  if (resumeErr) {
    throw new Error(`resume insert ${email}: ${resumeErr.message}`);
  }

  return { id: uid };
}

export async function deleteUser(userId: string): Promise<void> {
  const admin = adminClient();
  // Cascade deletes consents, resumes, rsvps, attendances via FK ON DELETE.
  await admin.auth.admin.deleteUser(userId).catch((err) => {
    // Swallow — test teardown shouldn't fail the run.
    console.warn(`[e2e:deleteUser] ${userId}: ${err.message}`);
  });
}

export async function deleteEventsBySuffix(suffix: string): Promise<void> {
  const admin = adminClient();
  await admin
    .from("events")
    .delete()
    .like("slug", `%${suffix}%`)
    .throwOnError()
    .then(
      () => undefined,
      (err) => {
        console.warn(`[e2e:deleteEventsBySuffix] ${suffix}: ${err.message}`);
      }
    );
}
