import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");

  console.log("→ anon client");
  const anon = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data: anonUser, error: anonErr } = await anon.auth.getUser();
  const isMissingSession =
    anonErr && (anonErr as { name?: string }).name === "AuthSessionMissingError";
  if (anonErr && !isMissingSession) {
    throw anonErr;
  }
  console.log(
    `  getUser (no session): ${
      isMissingSession ? "AuthSessionMissingError (expected)" : `user=${anonUser.user?.id ?? "null"}`
    }`
  );

  console.log("→ admin client");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const {
    data: { users },
    error: listErr,
  } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (listErr) throw listErr;
  console.log(`  admin.listUsers: got ${users.length} user(s) on page 1`);

  console.log("✓ supabase smoke OK");
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
