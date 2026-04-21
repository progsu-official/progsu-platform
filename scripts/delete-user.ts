// Dev convenience: delete an auth.users row by google email. Cascades to profiles
// via the FK + also clears resumes and storage objects so you can sign up fresh.
// Usage: pnpm tsx scripts/delete-user.ts <email>

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error("usage: pnpm tsx scripts/delete-user.ts <email>");
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

  // Find the user. auth.admin.listUsers paginates; for a single email lookup we can
  // filter client-side on the first page (plenty for local).
  const { data: list, error: listErr } =
    await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const user = list.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!user) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }

  // Storage prefixes are {user_id}/...; remove them so the bucket doesn't keep the PDF.
  const { data: objs } = await admin.storage.from("resumes").list(user.id);
  if (objs && objs.length) {
    const paths = objs.map((o) => `${user.id}/${o.name}`);
    await admin.storage.from("resumes").remove(paths);
    console.log(`removed ${paths.length} storage object(s) under ${user.id}/`);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) throw delErr;
  console.log(`✓ deleted ${email} (id=${user.id})`);
}

main().catch((err) => {
  console.error("delete-user failed:", err);
  process.exit(1);
});
