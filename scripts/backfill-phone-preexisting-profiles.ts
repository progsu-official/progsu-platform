#!/usr/bin/env tsx
// One-off backfill: handle_new_user()'s claim-backfill trigger only fires on
// brand-new accounts, so the ~192 members who signed up before
// legacy_members existed never got it. Same match rule (google_email against
// personal_email/campus_email, phone_number only if still null, never
// overwrite), just run once by hand instead of on insert.
//
// Usage:
//   pnpm tsx scripts/backfill-phone-preexisting-profiles.ts            # execute
//   pnpm tsx scripts/backfill-phone-preexisting-profiles.ts --dry-run  # preview only

import { config } from "dotenv";
config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: profiles, error: profilesErr } = await admin
    .from("profiles")
    .select("id, first_name, last_name, google_email, student_email, phone_number")
    .is("phone_number", null);
  if (profilesErr) throw new Error(`load profiles: ${profilesErr.message}`);

  const { data: legacy, error: legacyErr } = await admin
    .from("legacy_members")
    .select("personal_email, campus_email, phone_number")
    .is("claimed_at", null)
    .not("phone_number", "is", null);
  if (legacyErr) throw new Error(`load legacy_members: ${legacyErr.message}`);

  const byEmail = new Map<string, string>();
  for (const lm of legacy ?? []) {
    if (lm.personal_email) byEmail.set(lm.personal_email, lm.phone_number!);
    if (lm.campus_email) byEmail.set(lm.campus_email, lm.phone_number!);
  }

  const matches = (profiles ?? [])
    .map((p) => {
      const phone =
        byEmail.get(p.google_email ?? "") ?? byEmail.get(p.student_email ?? "");
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
      return phone ? { id: p.id, name, phone } : null;
    })
    .filter((m): m is { id: string; name: string | null; phone: string } => m !== null);

  console.log(`\nBackfill plan (${DRY_RUN ? "DRY RUN" : "EXECUTE"})`);
  console.log(`  Profiles missing phone_number: ${profiles?.length ?? 0}`);
  console.log(`  Matched against unclaimed legacy_members: ${matches.length}\n`);

  if (DRY_RUN) {
    for (const m of matches) console.log(`  ${m.name ?? "(no name)"} -> ${m.phone}`);
    console.log("\n[dry-run] no writes performed.");
    return;
  }

  let updated = 0;
  for (const m of matches) {
    const { error } = await admin
      .from("profiles")
      .update({ phone_number: m.phone })
      .eq("id", m.id)
      .is("phone_number", null); // still-null guard against a race since the read above
    if (error) {
      console.warn(`  ! failed ${m.name}: ${error.message}`);
      continue;
    }
    updated++;
  }
  console.log(`Updated ${updated}/${matches.length} profiles.`);
}

main().catch((err) => {
  console.error("✗ backfill failed:", err);
  process.exit(1);
});
