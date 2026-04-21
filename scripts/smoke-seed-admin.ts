import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawnSync } from "node:child_process";

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const email = `seed-admin-${Date.now()}@example.com`;
  let userId: string | null = null;
  try {
    const { data } = await admin.auth.admin.createUser({
      email,
      password: "testpassword-12345",
      email_confirm: true,
    });
    if (!data.user) throw new Error("create");
    userId = data.user.id;

    // 1. Run seed-admin to promote.
    const promote = spawnSync(
      "pnpm",
      ["tsx", "scripts/seed-admin.ts", email],
      { encoding: "utf8" }
    );
    if (promote.status !== 0) {
      throw new Error(`promote stderr: ${promote.stderr}`);
    }
    if (!promote.stdout.includes("promoted"))
      throw new Error(`promote stdout: ${promote.stdout}`);
    console.log(`  ✓ seed-admin promoted ${email}`);

    const { data: after } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .single();
    if (!after?.is_admin) throw new Error("is_admin did not flip");
    console.log(`  ✓ DB shows is_admin=true`);

    // 2. Revoke with --revoke.
    const revoke = spawnSync(
      "pnpm",
      ["tsx", "scripts/seed-admin.ts", "--revoke", email],
      { encoding: "utf8" }
    );
    if (revoke.status !== 0) {
      throw new Error(`revoke stderr: ${revoke.stderr}`);
    }
    if (!revoke.stdout.includes("demoted"))
      throw new Error(`revoke stdout: ${revoke.stdout}`);

    const { data: after2 } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .single();
    if (after2?.is_admin) throw new Error("is_admin did not revert");
    console.log(`  ✓ seed-admin --revoke demoted ${email}`);

    // 3. Unknown email → exit 1.
    const missing = spawnSync(
      "pnpm",
      ["tsx", "scripts/seed-admin.ts", `doesnotexist-${Date.now()}@example.com`],
      { encoding: "utf8" }
    );
    if (missing.status !== 1)
      throw new Error(`unknown email exit: ${missing.status}`);
    if (!missing.stderr.includes("no profile found"))
      throw new Error(`unknown email stderr: ${missing.stderr}`);
    console.log(`  ✓ unknown email → exit 1 with helpful message`);

    console.log("✓ seed-admin smoke OK");
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
