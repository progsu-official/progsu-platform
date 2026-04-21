// Seeds is_admin=true on one or more Google email addresses.
// Usage:
//   pnpm tsx scripts/seed-admin.ts admin1@example.com admin2@example.com
// or:
//   pnpm tsx scripts/seed-admin.ts --revoke admin1@example.com

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const argv = process.argv.slice(2);
  const revoke = argv.includes("--revoke");
  const emails = argv.filter((a) => !a.startsWith("--"));
  if (emails.length === 0) {
    console.error("usage: pnpm tsx scripts/seed-admin.ts [--revoke] <email> [<email> …]");
    process.exit(1);
  }

  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const targetAdmin = !revoke;
  for (const email of emails) {
    const lower = email.trim().toLowerCase();
    const { data, error } = await admin
      .from("profiles")
      .update({ is_admin: targetAdmin })
      .eq("google_email", lower)
      .select("id");
    if (error) {
      console.error(`✗ ${lower}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    if (!data || data.length === 0) {
      console.error(
        `✗ ${lower}: no profile found. The user must sign in at least once first so handle_new_user() creates the row.`
      );
      process.exitCode = 1;
      continue;
    }
    console.log(
      `${targetAdmin ? "✓ promoted" : "✓ demoted"} ${lower} → is_admin=${targetAdmin}`
    );
  }
}

main().catch((err) => {
  console.error("seed-admin failed:", err);
  process.exit(1);
});
