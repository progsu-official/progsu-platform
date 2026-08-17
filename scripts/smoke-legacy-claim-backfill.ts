// Asserts the first-Google-login claim flow in handle_new_user(): seeds one
// legacy_members row, creates an auth user with that same email (simulating
// first sign-in), and checks the resulting profile got backfilled and the
// staging row got marked claimed. Also checks it never touches consents.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = `smoke-claim-${Date.now()}@example.com`;
  let userId: string | null = null;

  try {
    const { error: seedErr } = await admin.from("legacy_members").insert({
      full_name: "Smoke Claim",
      first_name: "Smoke",
      last_name: "Claim",
      personal_email: email,
      phone_number: "+14045559999",
      sms_interest: true,
      source: "smoke_test",
    });
    if (seedErr) throw new Error(`seed legacy_members: ${seedErr.message}`);
    console.log("  ✓ seeded unclaimed legacy_members row");

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: "Smoke", family_name: "Claim" },
    });
    if (createErr || !created.user) throw new Error(`create user: ${createErr?.message}`);
    userId = created.user.id;

    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("phone_number")
      .eq("id", userId)
      .single();
    if (profErr || !profile) throw new Error(`profile missing: ${profErr?.message}`);
    if (profile.phone_number !== "+14045559999")
      throw new Error(`phone_number not backfilled: ${profile.phone_number}`);
    console.log("  ✓ profile.phone_number backfilled from legacy_members on first login");

    const { data: legacy, error: legacyErr } = await admin
      .from("legacy_members")
      .select("claimed_at, claimed_profile_id")
      .eq("personal_email", email)
      .single();
    if (legacyErr || !legacy) throw new Error(`legacy row missing: ${legacyErr?.message}`);
    if (!legacy.claimed_at) throw new Error("claimed_at should be set");
    if (legacy.claimed_profile_id !== userId)
      throw new Error(`claimed_profile_id mismatch: ${legacy.claimed_profile_id}`);
    console.log("  ✓ legacy_members row marked claimed, linked to the new profile");

    const { data: consents } = await admin
      .from("consents")
      .select("id")
      .eq("user_id", userId);
    if (consents && consents.length > 0)
      throw new Error("claim flow must never write consents");
    console.log("  ✓ no consent rows created by the claim flow (opt-in stays explicit)");

    console.log("✓ legacy-claim-backfill smoke OK");
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from("legacy_members").delete().eq("personal_email", email);
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
