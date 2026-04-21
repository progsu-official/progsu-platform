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

  // Create Alice and Bob via admin API, each with a password we know.
  async function makeUser(email: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: email.split("@")[0], family_name: "Tester" },
    });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
    return data.user;
  }

  const alice = await makeUser("alice@example.com");
  const bob = await makeUser("bob@example.com");
  console.log(`  seeded alice=${alice.id} bob=${bob.id}`);

  // Build a user-context client signed in as Alice.
  const aliceClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data: session, error: signInErr } = await aliceClient.auth.signInWithPassword(
    { email: "alice@example.com", password: "testpassword-12345" }
  );
  if (signInErr || !session.user) throw new Error(`alice signin: ${signInErr?.message}`);

  try {
    // 1. Alice can read her own row.
    const { data: ownRow, error: readErr } = await aliceClient
      .from("profiles")
      .select("id, is_admin, student_email_verified")
      .eq("id", alice.id)
      .single();
    if (readErr || !ownRow) throw new Error(`alice read own: ${readErr?.message}`);
    console.log(`  ✓ alice read own row (is_admin=${ownRow.is_admin})`);

    // 2. Alice cannot read Bob's row.
    const { data: bobRow, error: bobErr } = await aliceClient
      .from("profiles")
      .select("id")
      .eq("id", bob.id)
      .maybeSingle();
    if (bobErr && bobErr.code !== "PGRST116") {
      // PGRST116 = "No rows" which is the RLS-blocked pattern for maybeSingle.
      throw new Error(`alice read bob unexpected error: ${bobErr.message}`);
    }
    if (bobRow) throw new Error(`alice saw bob row: RLS LEAK`);
    console.log(`  ✓ alice cannot see bob row`);

    // 3. Alice cannot self-elevate is_admin.
    const { error: elevateErr, data: elevateData } = await aliceClient
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", alice.id)
      .select();
    if (!elevateErr && elevateData && elevateData.length > 0) {
      // The WITH CHECK guard should block this. If it "succeeds" but returns 0 rows
      // (i.e., update had no effect), that's still acceptable; but here we got rows back.
      throw new Error(`alice self-elevated to admin: ${JSON.stringify(elevateData)}`);
    }
    // PostgREST typically returns 0 rows when WITH CHECK rejects, or a 42501 error.
    // Re-read and confirm is_admin is still false.
    const { data: afterElevate } = await aliceClient
      .from("profiles")
      .select("is_admin")
      .eq("id", alice.id)
      .single();
    if (afterElevate?.is_admin !== false) {
      throw new Error(`alice.is_admin flipped to ${afterElevate?.is_admin}`);
    }
    console.log(
      `  ✓ alice cannot self-elevate is_admin (err=${elevateErr?.code ?? "none"}, rows=${elevateData?.length ?? 0})`
    );

    // 4. Alice cannot flip her own student_email_verified.
    const { data: verifyData, error: verifyErr } = await aliceClient
      .from("profiles")
      .update({ student_email_verified: true })
      .eq("id", alice.id)
      .select();
    const { data: afterVerify } = await aliceClient
      .from("profiles")
      .select("student_email_verified")
      .eq("id", alice.id)
      .single();
    if (afterVerify?.student_email_verified !== false) {
      throw new Error(`alice flipped student_email_verified`);
    }
    console.log(
      `  ✓ alice cannot flip student_email_verified directly (err=${verifyErr?.code ?? "none"}, rows=${verifyData?.length ?? 0})`
    );

    // 5. Alice CAN update her own first_name.
    const { error: nameErr } = await aliceClient
      .from("profiles")
      .update({ first_name: "Alice-Updated" })
      .eq("id", alice.id);
    if (nameErr) throw new Error(`alice name update: ${nameErr.message}`);
    const { data: afterName } = await aliceClient
      .from("profiles")
      .select("first_name")
      .eq("id", alice.id)
      .single();
    if (afterName?.first_name !== "Alice-Updated") {
      throw new Error(`alice name did not stick: ${afterName?.first_name}`);
    }
    console.log(`  ✓ alice can update her own first_name`);

    // 6. Alice cannot update Bob's row at all.
    const { data: bobUpdate } = await aliceClient
      .from("profiles")
      .update({ first_name: "Haxxor" })
      .eq("id", bob.id)
      .select();
    const { data: bobAfter } = await admin
      .from("profiles")
      .select("first_name")
      .eq("id", bob.id)
      .single();
    if (bobAfter?.first_name === "Haxxor") {
      throw new Error(`alice modified bob's row`);
    }
    console.log(`  ✓ alice cannot update bob (rows touched: ${bobUpdate?.length ?? 0})`);
  } finally {
    // Cleanup
    await admin.auth.admin.deleteUser(alice.id).catch(() => {});
    await admin.auth.admin.deleteUser(bob.id).catch(() => {});
  }

  console.log("✓ RLS self-elevation + cross-user checks OK");
}

main().catch((err) => {
  console.error("✗ RLS smoke failed:", err);
  process.exit(1);
});
