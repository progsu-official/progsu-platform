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

  // 1. First 3 hits allowed in a 60-second window of max 3.
  const bucket = `test_${Date.now()}`;
  const key = "user-x";
  for (let i = 0; i < 3; i++) {
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_bucket: bucket,
      p_key: key,
      p_max_hits: 3,
      p_window_seconds: 60,
    });
    if (error) throw new Error(`rpc err: ${error.message}`);
    const row = data?.[0] as
      | { allowed: boolean; retry_after_ms: number; hits_in_window: number }
      | undefined;
    if (!row?.allowed)
      throw new Error(`hit ${i + 1} should be allowed, got ${JSON.stringify(row)}`);
    if (row.hits_in_window !== i + 1)
      throw new Error(`hits=${row.hits_in_window} expected ${i + 1}`);
  }
  console.log(`  ✓ first 3 hits allowed`);

  // 2. 4th hit rejected with retry_after_ms > 0.
  const { data: denied } = await admin.rpc("consume_rate_limit", {
    p_bucket: bucket,
    p_key: key,
    p_max_hits: 3,
    p_window_seconds: 60,
  });
  const row = denied?.[0] as
    | { allowed: boolean; retry_after_ms: number; hits_in_window: number }
    | undefined;
  if (row?.allowed) throw new Error("4th hit should be blocked");
  if (!row?.retry_after_ms || row.retry_after_ms <= 0)
    throw new Error(`retry_after_ms should be > 0, got ${row?.retry_after_ms}`);
  console.log(
    `  ✓ 4th hit blocked (retry_after_ms=${row?.retry_after_ms}, hits=${row?.hits_in_window})`
  );

  // 3. Different key in the same bucket is independent.
  const { data: otherKey } = await admin.rpc("consume_rate_limit", {
    p_bucket: bucket,
    p_key: "user-y",
    p_max_hits: 3,
    p_window_seconds: 60,
  });
  if (!otherKey?.[0]?.allowed)
    throw new Error(`other key should be allowed`);
  console.log(`  ✓ independent key in same bucket allowed`);

  // 4. write_audit callable by service role with null actor.
  const { data: auditId, error: auditErr } = await admin.rpc("write_audit", {
    p_action: "test_audit",
    p_actor: null,
    p_target: null,
    p_metadata: { note: "smoke" },
  });
  if (auditErr) throw new Error(`write_audit svc: ${auditErr.message}`);
  if (typeof auditId !== "string")
    throw new Error(`expected uuid, got ${auditId}`);
  console.log(`  ✓ write_audit(service role, null actor) inserted id=${auditId}`);

  // 5. write_audit refuses to impersonate from authenticated context.
  //    Use two real users so we hit the `raise exception` branch, not a FK error.
  const { data: alice } = await admin.auth.admin.createUser({
    email: `audit-alice-${Date.now()}@example.com`,
    password: "testpassword-12345",
    email_confirm: true,
  });
  const { data: bob } = await admin.auth.admin.createUser({
    email: `audit-bob-${Date.now()}@example.com`,
    password: "testpassword-12345",
    email_confirm: true,
  });
  if (!alice.user || !bob.user) throw new Error("could not create users");

  const userClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  await userClient.auth.signInWithPassword({
    email: alice.user.email!,
    password: "testpassword-12345",
  });

  // Alice tries to write audit as bob → expect explicit raise_exception (code P0001).
  const { error: impersonateErr } = await userClient.rpc("write_audit", {
    p_action: "impersonation_attempt",
    p_actor: bob.user.id, // NOT alice
    p_target: null,
    p_metadata: {},
  });
  if (!impersonateErr)
    throw new Error(`write_audit should reject mismatched actor`);
  if (impersonateErr.code !== "P0001")
    throw new Error(
      `expected P0001 (raise_exception), got ${impersonateErr.code}: ${impersonateErr.message}`
    );
  console.log(
    `  ✓ write_audit rejects mismatched actor (P0001: ${impersonateErr.message.slice(0, 60)})`
  );

  // Alice writes audit as herself → success.
  const { data: selfAuditId, error: selfErr } = await userClient.rpc(
    "write_audit",
    {
      p_action: "self_audit_ok",
      p_actor: alice.user.id,
      p_target: alice.user.id,
      p_metadata: { note: "alice->alice" },
    }
  );
  if (selfErr) throw new Error(`self audit: ${selfErr.message}`);
  if (typeof selfAuditId !== "string") throw new Error(`bad selfAuditId`);
  console.log(`  ✓ write_audit accepts self-actor from authenticated context`);

  // Cleanup
  await admin.auth.admin.deleteUser(alice.user.id).catch(() => {});
  await admin.auth.admin.deleteUser(bob.user.id).catch(() => {});
  await admin.from("rate_limit_hits").delete().eq("bucket", bucket);
  // Audit rows cascade on user delete for actor_user_id=alice, target=alice (set null). The
  // service-role row (auditId) stays; manual delete:
  await admin.from("audit_log").delete().in("id", [auditId, selfAuditId]);

  console.log("✓ rate-limit + audit RPCs smoke OK");
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
