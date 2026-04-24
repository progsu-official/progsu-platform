#!/usr/bin/env tsx
// Smoke: is_fully_onboarded(user_id) in the DB must agree with
// loadOnboardingState(user_id).fullyOnboarded in the app for every scenario.
// This is the merge-gate smoke — if it fails, the DB helper and the app helper
// disagree and server actions that trust one but not the other will ship bugs.
//
// loadOnboardingState source of truth: lib/auth/onboarding.ts. Key facts (as of
// migration 20260427000300 — low-friction signup refactor):
//   - profileFieldsComplete requires first_name, last_name, school, major,
//     phone_number all non-empty. When major='other', major_other_text must
//     also be non-empty. class_standing / grad_year / grad_term /
//     interested_roles are NO LONGER part of the hard gate — they live in the
//     dashboard profile-completion ring.
//   - hasCurrentResume is surfaced on OnboardingState for the ring/recruiter
//     gate, but is NOT part of fullyOnboarded (soft since 20260426000200).
//   - requiredConsentsCurrent: privacy_policy, terms_of_service, age_confirmation
//     must each have a latest-per-type row that is accepted=true at the current
//     consent_versions version.
//   - student_email_verified is intentionally NOT part of fullyOnboarded.
//   - NO admin bypass — admins with incomplete profile return fullyOnboarded=false.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

type Scenario = {
  name: string;
  expected: boolean;
  setup: (admin: import("@supabase/supabase-js").SupabaseClient, userId: string) => Promise<void>;
  isAdmin?: boolean;
};

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { loadOnboardingState } = await import("../lib/auth/onboarding");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Pull current versions once so scenarios use whatever migrations have
  // landed (privacy_policy is at v2 for R2, etc.).
  const { data: versionRows } = await admin
    .from("consent_versions")
    .select("consent_type, version");
  const currentVersions = new Map<string, string>(
    (versionRows ?? []).map((r) => [r.consent_type as string, r.version as string])
  );

  const suffix = Date.now();

  // Helpers used by scenarios.
  const y = new Date().getFullYear() + 1;

  // fills exactly the new minimum-bar profile: first/last/school/major/phone.
  // Uses the canonical 'computer_science' slug from the majors seed.
  async function fillCompleteProfile(userId: string) {
    const { error } = await admin
      .from("profiles")
      .update({
        first_name: "Parity",
        last_name: "User",
        school: "Georgia State University",
        major: "computer_science",
        phone_number: "555-555-5555",
      })
      .eq("id", userId);
    if (error) throw new Error(`fillCompleteProfile: ${error.message}`);
  }

  async function addActiveResume(userId: string) {
    const { error } = await admin.from("resumes").insert({
      id: crypto.randomUUID(),
      user_id: userId,
      storage_path: `${userId}/parity.pdf`,
      file_name: "parity.pdf",
      file_size: 9,
      mime_type: "application/pdf",
      status: "active",
      is_current: true,
    });
    if (error) throw new Error(`addActiveResume: ${error.message}`);
  }

  async function addSoftDeletedResume(userId: string) {
    // Soft-deleted resumes: status='deleted' and is_current typically flipped
    // to false at delete time. The app filter is .eq('is_current', true), so
    // this row won't match. is_fully_onboarded (DB) ALSO requires
    // status='active'. Net: both should return false if no active current exists.
    const { error } = await admin.from("resumes").insert({
      id: crypto.randomUUID(),
      user_id: userId,
      storage_path: `${userId}/parity-deleted.pdf`,
      file_name: "parity-deleted.pdf",
      file_size: 9,
      mime_type: "application/pdf",
      status: "deleted",
      is_current: false,
    });
    if (error) throw new Error(`addSoftDeletedResume: ${error.message}`);
  }

  async function addAllRequiredConsentsCurrent(userId: string) {
    const ts = new Date().toISOString();
    const { error } = await admin.from("consents").insert(
      ["privacy_policy", "terms_of_service", "age_confirmation"].map((t) => ({
        user_id: userId,
        consent_type: t,
        accepted: true,
        version: currentVersions.get(t) ?? "v1",
        accepted_at: ts,
      }))
    );
    if (error) throw new Error(`addAllRequiredConsentsCurrent: ${error.message}`);
  }

  async function addStaleConsent(userId: string, type: string) {
    // Accepts at a non-current version ("v0") so latest-per-type mismatches the
    // current version ("v1") from consent_versions.
    const { error } = await admin.from("consents").insert({
      user_id: userId,
      consent_type: type,
      accepted: true,
      version: "v0",
      accepted_at: new Date().toISOString(),
    });
    if (error) throw new Error(`addStaleConsent ${type}: ${error.message}`);
  }

  async function addWrongVersionConsent(userId: string, type: string) {
    const { error } = await admin.from("consents").insert({
      user_id: userId,
      consent_type: type,
      accepted: true,
      version: "v99",
      accepted_at: new Date().toISOString(),
    });
    if (error) throw new Error(`addWrongVersionConsent ${type}: ${error.message}`);
  }

  // Scenarios mirror docs/14-low-friction-signup/06-smoke-and-e2e.md §1.
  // y is unused now that grad_year isn't in the gate; intentionally reference it
  // in a comment so the reader knows removing old-gate checks was deliberate.
  void y;
  const scenarios: Scenario[] = [
    // 1. Fresh profile row (handle_new_user trigger) — nothing filled.
    {
      name: "brand-new user (no profile fields, no resume, no consents)",
      expected: false,
      setup: async () => {},
    },

    // 2. New minimum bar satisfied, no resume. Expected TRUE: resume and
    //    verification are both SOFT since 20260426000200 / 20260427000300.
    {
      name: "min profile + 3 consents, no resume",
      expected: true,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 3. Major='other' with major_other_text set. Expected TRUE.
    {
      name: "major='other' with major_other_text provided",
      expected: true,
      setup: async (a, uid) => {
        await a
          .from("profiles")
          .update({
            first_name: "Parity",
            last_name: "User",
            school: "Georgia State University",
            major: "other",
            major_other_text: "Cognitive Science",
            phone_number: "555-555-5555",
          })
          .eq("id", uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 4. Major='other' without major_other_text — gate should fail on the
    //    cross-column rule.
    {
      name: "major='other' without major_other_text → blocked",
      expected: false,
      setup: async (a, uid) => {
        await a
          .from("profiles")
          .update({
            first_name: "Parity",
            last_name: "User",
            school: "Georgia State University",
            major: "other",
            major_other_text: null,
            phone_number: "555-555-5555",
          })
          .eq("id", uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 5. Missing phone_number.
    {
      name: "missing phone_number",
      expected: false,
      setup: async (a, uid) => {
        await fillCompleteProfile(uid);
        await a.from("profiles").update({ phone_number: null }).eq("id", uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 6. Missing major.
    {
      name: "missing major",
      expected: false,
      setup: async (a, uid) => {
        await fillCompleteProfile(uid);
        await a.from("profiles").update({ major: null }).eq("id", uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 7. Missing school.
    {
      name: "missing school",
      expected: false,
      setup: async (a, uid) => {
        await fillCompleteProfile(uid);
        await a.from("profiles").update({ school: null }).eq("id", uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 8. Missing a required consent (age_confirmation).
    {
      name: "min profile, missing age_confirmation consent",
      expected: false,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        const ts = new Date().toISOString();
        await admin.from("consents").insert(
          ["privacy_policy", "terms_of_service"].map((t) => ({
            user_id: uid,
            consent_type: t,
            accepted: true,
            version: currentVersions.get(t) ?? "v1",
            accepted_at: ts,
          }))
        );
      },
    },

    // 9. Stale privacy_policy consent (accepted at v0, not current).
    {
      name: "stale privacy_policy consent",
      expected: false,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        await addStaleConsent(uid, "privacy_policy");
        const ts = new Date().toISOString();
        await admin.from("consents").insert(
          ["terms_of_service", "age_confirmation"].map((t) => ({
            user_id: uid,
            consent_type: t,
            accepted: true,
            version: currentVersions.get(t) ?? "v1",
            accepted_at: ts,
          }))
        );
      },
    },

    // 10. Pre-refactor "fully completed old gate" user: all the fields we
    //     REMOVED from the gate (class_standing, grad_year, grad_term,
    //     interested_roles) plus the new minimum and a resume. Should still
    //     pass. Verifies back-compat for existing members.
    {
      name: "old-gate-complete user still passes under new gate",
      expected: true,
      setup: async (a, uid) => {
        await fillCompleteProfile(uid);
        await a
          .from("profiles")
          .update({
            class_standing: "junior",
            grad_year: y,
            grad_term: `Fall ${y}`,
            interested_roles: ["software_engineering"],
          })
          .eq("id", uid);
        await addActiveResume(uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 11. Admin with empty profile — no admin bypass, both helpers return false.
    {
      name: "admin with incomplete profile (no admin bypass)",
      expected: false,
      isAdmin: true,
      setup: async () => {},
    },

    // 12. Wrong-version age_confirmation (version literal 'v99', guaranteed mismatch).
    {
      name: "wrong-version age_confirmation",
      expected: false,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        const ts = new Date().toISOString();
        await admin.from("consents").insert(
          ["privacy_policy", "terms_of_service"].map((t) => ({
            user_id: uid,
            consent_type: t,
            accepted: true,
            version: currentVersions.get(t) ?? "v1",
            accepted_at: ts,
          }))
        );
        await addWrongVersionConsent(uid, "age_confirmation");
      },
    },

    // 13. Soft-deleted resume only — resume soft gate (unchanged since 20260426000200).
    {
      name: "soft-deleted resume only — soft gate",
      expected: true,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        await addSoftDeletedResume(uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },
  ];

  const createdUserIds: string[] = [];
  try {
    for (const [idx, s] of scenarios.entries()) {
      const email = `parity-${idx}-${suffix}@example.com`;
      const { data: created, error: createErr } = await admin.auth.admin.createUser(
        {
          email,
          password: "testpassword-12345",
          email_confirm: true,
          user_metadata: { given_name: "Parity", family_name: "User" },
        }
      );
      if (createErr || !created.user) {
        throw new Error(
          `scenario ${idx} create user: ${createErr?.message}`
        );
      }
      const uid = created.user.id;
      createdUserIds.push(uid);
      if (s.isAdmin) {
        await admin
          .from("profiles")
          .update({ is_admin: true })
          .eq("id", uid);
      }
      await s.setup(admin, uid);

      // DB side: is_fully_onboarded(user_id).
      const { data: dbBool, error: dbErr } = await admin.rpc(
        "is_fully_onboarded",
        { p_user_id: uid }
      );
      if (dbErr) {
        throw new Error(`scenario ${idx} is_fully_onboarded: ${dbErr.message}`);
      }
      // App side: loadOnboardingState(service client, user_id).fullyOnboarded.
      // NB: loadOnboardingState uses the caller client — feed it the service-
      // role client so RLS isn't in the way of the parity check. The DB helper
      // also runs as security definer, so both sides read the full state.
      const state = await loadOnboardingState(admin, uid);
      const appBool = state.fullyOnboarded;

      if (dbBool !== s.expected || appBool !== s.expected) {
        throw new Error(
          `PARITY BREAK [${idx}] "${s.name}": expected=${s.expected} db=${dbBool} app=${appBool} state=${JSON.stringify(state)}`
        );
      }
      console.log(
        `[smoke-onboarding-parity] OK: [${idx}] ${s.name} → db=${dbBool} app=${appBool} (expected ${s.expected})`
      );
    }

    console.log(
      `[smoke-onboarding-parity] ALL OK (${scenarios.length} scenarios parity-checked)`
    );
  } finally {
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-onboarding-parity] FAILED:", err);
  process.exit(1);
});
