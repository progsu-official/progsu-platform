#!/usr/bin/env tsx
// Smoke: is_fully_onboarded(user_id) in the DB must agree with
// loadOnboardingState(user_id).fullyOnboarded in the app for every scenario.
// This is the merge-gate smoke — if it fails, the DB helper and the app helper
// disagree and server actions that trust one but not the other will ship bugs.
//
// loadOnboardingState source of truth: lib/auth/onboarding.ts. Key facts verified
// directly from that file before writing this smoke:
//   - profileFieldsComplete requires first_name, last_name, school, major,
//     class_standing, grad_year, grad_term all non-empty AND interested_roles > 0.
//   - hasCurrentResume = one resume row is_current = true (caller filter).
//     Note: app-side only filters is_current; DB side filters is_current AND
//     status='active'. For a soft-deleted (status='deleted') resume with no
//     active current row, both return false because the app's
//     .eq('is_current', true) won't match (soft delete flips is_current off).
//     Scenario 8 below covers this path.
//   - requiredConsentsCurrent: privacy_policy, terms_of_service, age_confirmation
//     must each have a latest-per-type row that is accepted=true at the current
//     consent_versions version.
//   - student_email_verified is intentionally NOT part of fullyOnboarded.
//   - NO admin bypass — admins with incomplete profile return fullyOnboarded=false
//     (matches DB helper, which also has no admin bypass per migration 000009 note).

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

  async function fillCompleteProfile(userId: string) {
    const { error } = await admin
      .from("profiles")
      .update({
        first_name: "Parity",
        last_name: "User",
        school: "Georgia State University",
        major: "Computer Science",
        class_standing: "junior",
        grad_year: y,
        grad_term: `Fall ${y}`,
        interested_roles: ["software_engineering"],
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

  const scenarios: Scenario[] = [
    // 1. Brand-new user: profile row exists via handle_new_user() trigger but
    //    has no required fields, no resume, no consents.
    {
      name: "brand-new user (no profile fields, no resume, no consents)",
      expected: false,
      setup: async () => {},
    },

    // 2. Profile complete except grad_term missing.
    {
      name: "profile missing grad_term",
      expected: false,
      setup: async (a, uid) => {
        await a
          .from("profiles")
          .update({
            first_name: "Parity",
            last_name: "User",
            school: "Georgia State University",
            major: "Computer Science",
            class_standing: "junior",
            grad_year: y,
            grad_term: null,
            interested_roles: ["software_engineering"],
          })
          .eq("id", uid);
        await addActiveResume(uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 3. Profile + resume but privacy_policy consent is stale (v0 < current v1).
    {
      name: "profile + resume, stale privacy_policy consent",
      expected: false,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        await addActiveResume(uid);
        // terms + age current, but privacy_policy stale.
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

    // 4. Fully onboarded happy path.
    {
      name: "profile + resume + all 3 consents at current versions",
      expected: true,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        await addActiveResume(uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 5. Admin with incomplete profile: still false. No admin bypass per
    //    onboarding.ts (fullyOnboarded is purely profile+resume+consents) AND
    //    no admin bypass per migration 000009 comment. Both must agree = false.
    {
      name: "admin with incomplete profile (no admin bypass)",
      expected: false,
      isAdmin: true,
      setup: async () => {},
    },

    // 6. interested_roles = []: profileFieldsComplete false.
    {
      name: "profile complete but interested_roles = []",
      expected: false,
      setup: async (a, uid) => {
        await a
          .from("profiles")
          .update({
            first_name: "Parity",
            last_name: "User",
            school: "Georgia State University",
            major: "Computer Science",
            class_standing: "junior",
            grad_year: y,
            grad_term: `Fall ${y}`,
            interested_roles: [],
          })
          .eq("id", uid);
        await addActiveResume(uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 7. student_email_verified=false, everything else current → both true
    //    (verification is NOT a hard gate for fullyOnboarded).
    {
      name: "student_email_verified=false but everything else current",
      expected: true,
      setup: async (a, uid) => {
        await fillCompleteProfile(uid);
        await a
          .from("profiles")
          .update({ student_email_verified: false })
          .eq("id", uid);
        await addActiveResume(uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 8. Soft-deleted (status='deleted') resume, no active current → both false.
    {
      name: "soft-deleted resume only, no active current",
      expected: false,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        await addSoftDeletedResume(uid);
        await addAllRequiredConsentsCurrent(uid);
      },
    },

    // 9. Wrong version accepted on age_confirmation.
    {
      name: "wrong-version age_confirmation",
      expected: false,
      setup: async (_a, uid) => {
        await fillCompleteProfile(uid);
        await addActiveResume(uid);
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
