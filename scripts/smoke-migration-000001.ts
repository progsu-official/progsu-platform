import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const checks: Array<() => Promise<void>> = [];

  // 1. school_domains seeded with 6 rows.
  checks.push(async () => {
    const { data, error } = await admin
      .from("school_domains")
      .select("domain, school_slug, is_active")
      .order("domain", { ascending: true });
    if (error) throw new Error(`school_domains query: ${error.message}`);
    if (!data || data.length !== 6) {
      throw new Error(`expected 6 seeded domains, got ${data?.length ?? 0}`);
    }
    const domains = data.map((r) => r.domain).join(",");
    const expected = [
      "emory.edu",
      "gatech.edu",
      "gcsu.edu",
      "gsu.edu",
      "kennesaw.edu",
      "student.gsu.edu",
    ].join(",");
    if (domains !== expected) {
      throw new Error(`unexpected domain set: ${domains}`);
    }
    console.log(`  ✓ school_domains has 6 rows (${domains})`);
  });

  // 2. profiles table exists, is empty, is_admin helper works.
  checks.push(async () => {
    const { count, error } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(`profiles count: ${error.message}`);
    console.log(`  ✓ profiles table exists, ${count ?? 0} row(s)`);
  });

  // 3. Seed an auth user and confirm trigger created the profile row.
  let triggerUserId: string | null = null;
  checks.push(async () => {
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email: "trigger-test@example.com",
        email_confirm: true,
        user_metadata: {
          full_name: "Trigger Test",
          given_name: "Trigger",
          family_name: "Test",
          avatar_url: "https://example.com/a.png",
        },
      });
    if (createErr || !created.user) {
      throw new Error(`createUser: ${createErr?.message ?? "no user"}`);
    }
    triggerUserId = created.user.id;

    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id, google_email, first_name, last_name, avatar_url, is_admin")
      .eq("id", triggerUserId)
      .single();
    if (profileErr || !profile) {
      throw new Error(
        `trigger did not create profiles row: ${profileErr?.message ?? "no row"}`
      );
    }
    if (profile.first_name !== "Trigger" || profile.last_name !== "Test") {
      throw new Error(
        `first/last split wrong: ${profile.first_name} / ${profile.last_name}`
      );
    }
    if (profile.is_admin !== false) {
      throw new Error("default is_admin should be false");
    }
    console.log(
      `  ✓ handle_new_user() created profile (${profile.first_name} ${profile.last_name}, admin=${profile.is_admin})`
    );
  });

  // 4. RLS: anon client (no session) cannot read profiles.
  checks.push(async () => {
    const anon = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { data, error } = await anon.from("profiles").select("id");
    // Anon role is outside the policies' `to authenticated` grant, so it should get 0 rows.
    if (error) {
      console.log(`  ✓ anon read blocked with error: ${error.message}`);
    } else if (!data || data.length === 0) {
      console.log(`  ✓ anon read returns 0 rows (RLS enforced)`);
    } else {
      throw new Error(`anon read returned ${data.length} rows — RLS leak`);
    }
  });

  // 5. is_admin() helper returns false for the trigger-test user.
  checks.push(async () => {
    if (!triggerUserId) throw new Error("no triggerUserId");
    const { data, error } = await admin.rpc("is_admin", {
      p_user_id: triggerUserId,
    });
    if (error) throw new Error(`is_admin rpc: ${error.message}`);
    if (data !== false) throw new Error(`is_admin expected false, got ${data}`);
    console.log(`  ✓ public.is_admin(non-admin) = false`);
  });

  // 6. Cleanup — delete the test auth user.
  checks.push(async () => {
    if (!triggerUserId) return;
    const { error } = await admin.auth.admin.deleteUser(triggerUserId);
    if (error) throw new Error(`deleteUser: ${error.message}`);
    const { data: after } = await admin
      .from("profiles")
      .select("id")
      .eq("id", triggerUserId);
    if (after && after.length > 0) {
      throw new Error("profile row did not cascade-delete with auth.users");
    }
    console.log(`  ✓ auth.users delete cascades to profiles`);
  });

  for (const c of checks) {
    await c();
  }
  console.log("✓ migration 000001 smoke OK");
}

main().catch((err) => {
  console.error("✗ migration smoke failed:", err);
  process.exit(1);
});
