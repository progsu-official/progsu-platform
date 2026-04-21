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

  // Seed a user.
  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    {
      email: "alice@example.com",
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: "Alice", family_name: "Example" },
    }
  );
  if (createErr || !created.user) throw new Error(`create: ${createErr?.message}`);
  const alice = created.user;
  console.log(`  seeded user=${alice.id}`);

  const aliceClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { error: signInErr } = await aliceClient.auth.signInWithPassword({
    email: "alice@example.com",
    password: "testpassword-12345",
  });
  if (signInErr) throw new Error(`signin: ${signInErr.message}`);

  try {
    // 1. consent_versions seeded with 5 rows at v1.
    const { data: versions, error: vErr } = await admin
      .from("consent_versions")
      .select("consent_type, version")
      .order("consent_type");
    if (vErr || !versions) throw new Error(`versions: ${vErr?.message}`);
    if (versions.length !== 5)
      throw new Error(`expected 5 version rows, got ${versions.length}`);
    if (!versions.every((v) => v.version === "v1"))
      throw new Error(`not all versions are v1: ${JSON.stringify(versions)}`);
    console.log(`  ✓ consent_versions seeded: 5 rows all v1`);

    // 2. Alice can insert a consent row for herself.
    const { error: c1Err } = await aliceClient.from("consents").insert({
      user_id: alice.id,
      consent_type: "privacy_policy",
      accepted: true,
      version: "v1",
    });
    if (c1Err) throw new Error(`alice consent insert: ${c1Err.message}`);

    // 2a. Insert again (toggle off) — reconciliation #28 says multiple rows allowed.
    const { error: c2Err } = await aliceClient.from("consents").insert({
      user_id: alice.id,
      consent_type: "privacy_policy",
      accepted: false,
      version: "v1",
    });
    if (c2Err)
      throw new Error(
        `alice second consent insert rejected (expected allowed): ${c2Err.message}`
      );
    const { data: consentRows } = await admin
      .from("consents")
      .select("id, accepted, accepted_at")
      .eq("user_id", alice.id)
      .eq("consent_type", "privacy_policy")
      .order("accepted_at", { ascending: false })
      .order("id", { ascending: false });
    if (!consentRows || consentRows.length !== 2)
      throw new Error(`expected 2 consent rows, got ${consentRows?.length}`);
    console.log(
      `  ✓ consents append-only, 2 rows for (alice, privacy_policy, v1) latest.accepted=${consentRows[0].accepted}`
    );

    // 3. consents UPDATE is rejected.
    const { data: updData, error: updErr } = await aliceClient
      .from("consents")
      .update({ accepted: false })
      .eq("user_id", alice.id)
      .select();
    if (!updErr && updData && updData.length > 0) {
      throw new Error(`consent update should be rejected by RLS`);
    }
    console.log(`  ✓ consents UPDATE rejected (err=${updErr?.code ?? "none"})`);

    // 4. Alice cannot read email_verification_codes even if they exist.
    const { data: evcAdminIns, error: evcIns } = await admin
      .from("email_verification_codes")
      .insert({
        user_id: alice.id,
        email: "alice@student.gsu.edu",
        code_hash: "fakehash",
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .select()
      .single();
    if (evcIns || !evcAdminIns) throw new Error(`evc admin insert: ${evcIns?.message}`);

    const { data: evcRead } = await aliceClient
      .from("email_verification_codes")
      .select("id");
    if (evcRead && evcRead.length > 0) {
      throw new Error(`alice saw EVC rows: ${evcRead.length}`);
    }
    console.log(`  ✓ email_verification_codes invisible to authenticated user`);

    // 5. resumes insert must have is_current=false and status='pending'.
    const resumeId = crypto.randomUUID();
    const { error: resOk } = await aliceClient.from("resumes").insert({
      id: resumeId,
      user_id: alice.id,
      storage_path: `${alice.id}/${resumeId}.pdf`,
      file_name: "resume.pdf",
      file_size: 1024,
      mime_type: "application/pdf",
    });
    if (resOk) throw new Error(`alice resume insert: ${resOk.message}`);

    // Try to insert with is_current=true — should be rejected by WITH CHECK.
    const { error: resBadErr } = await aliceClient.from("resumes").insert({
      user_id: alice.id,
      storage_path: `${alice.id}/${crypto.randomUUID()}.pdf`,
      file_name: "cheat.pdf",
      file_size: 512,
      mime_type: "application/pdf",
      is_current: true,
    });
    if (!resBadErr) throw new Error(`resume is_current=true on insert should be rejected`);
    console.log(
      `  ✓ resumes insert forces is_current=false (rejected with ${resBadErr.code})`
    );

    // Try to insert oversized file — should be rejected by CHECK / WITH CHECK.
    const { error: resBigErr } = await aliceClient.from("resumes").insert({
      user_id: alice.id,
      storage_path: `${alice.id}/${crypto.randomUUID()}.pdf`,
      file_name: "huge.pdf",
      file_size: 20 * 1024 * 1024,
      mime_type: "application/pdf",
    });
    if (!resBigErr) throw new Error(`>10MB resume should be rejected`);
    console.log(`  ✓ resumes >10MB rejected (${resBigErr.code})`);

    // 6. Client cannot UPDATE resumes directly.
    const { data: resUpd, error: resUpdErr } = await aliceClient
      .from("resumes")
      .update({ status: "active" })
      .eq("id", resumeId)
      .select();
    if (resUpd && resUpd.length > 0) {
      throw new Error("client flipped resume status");
    }
    console.log(
      `  ✓ resumes UPDATE blocked (err=${resUpdErr?.code ?? "0 rows"})`
    );

    // 7. Partial unique index: only one is_current=true per user (tested via admin).
    const resumeA = crypto.randomUUID();
    const resumeB = crypto.randomUUID();
    await admin.from("resumes").insert([
      {
        id: resumeA,
        user_id: alice.id,
        storage_path: `${alice.id}/${resumeA}.pdf`,
        file_name: "a.pdf",
        file_size: 1000,
        mime_type: "application/pdf",
        status: "active",
        is_current: true,
      },
    ]);
    const { error: dupCurrent } = await admin.from("resumes").insert({
      id: resumeB,
      user_id: alice.id,
      storage_path: `${alice.id}/${resumeB}.pdf`,
      file_name: "b.pdf",
      file_size: 1000,
      mime_type: "application/pdf",
      status: "active",
      is_current: true,
    });
    if (!dupCurrent) throw new Error("partial unique index did not fire");
    console.log(
      `  ✓ partial unique index on (is_current) rejected second current (${dupCurrent.code})`
    );

    // 8. Storage bucket exists and is private.
    const { data: buckets } = await admin.storage.listBuckets();
    const resumesBucket = buckets?.find((b) => b.id === "resumes");
    if (!resumesBucket) throw new Error("resumes bucket missing");
    if (resumesBucket.public)
      throw new Error("resumes bucket should be private");
    console.log(
      `  ✓ storage bucket 'resumes' exists and is private (public=${resumesBucket.public})`
    );

    // 9. account_deletion_requests: user can insert pending, cannot insert completed.
    const { error: delReqOk } = await aliceClient
      .from("account_deletion_requests")
      .insert({ user_id: alice.id, reason: "testing" });
    if (delReqOk) throw new Error(`deletion request insert: ${delReqOk.message}`);

    const { error: delReqBad } = await aliceClient
      .from("account_deletion_requests")
      .insert({
        user_id: alice.id,
        reason: "testing2",
        status: "completed",
      });
    if (!delReqBad)
      throw new Error("user should not be able to insert completed status");
    console.log(
      `  ✓ account_deletion_requests: pending insert ok, completed rejected (${delReqBad.code})`
    );
  } finally {
    await admin.auth.admin.deleteUser(alice.id).catch(() => {});
  }

  console.log("✓ migration 000002 smoke OK");
}

main().catch((err) => {
  console.error("✗ migration 000002 smoke failed:", err);
  process.exit(1);
});
