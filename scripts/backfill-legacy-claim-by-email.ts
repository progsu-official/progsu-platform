#!/usr/bin/env tsx
// One-off: backfill-phone-preexisting-profiles.ts (2026-08-18) only claimed
// a legacy_members row for profiles missing phone_number, wrongly coupling
// "claim this legacy identity" to "this profile needs a phone backfilled".
// Anyone who already had their own phone number (most early/founding
// members, including Joey) never got claimed_at/claimed_profile_id set even
// though their email matches a real imported legacy identity with real
// historical attendance. This claims by email match alone, decoupled from
// phone_number entirely — never touches phone_number or any other profile
// field, only sets legacy_members.claimed_at/claimed_profile_id where null.
//
// Usage:
//   pnpm tsx scripts/backfill-legacy-claim-by-email.ts            # execute
//   pnpm tsx scripts/backfill-legacy-claim-by-email.ts --dry-run  # preview only

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
    .select("id, first_name, last_name, google_email, student_email");
  if (profilesErr) throw new Error(`load profiles: ${profilesErr.message}`);

  // legacy_members has 1400+ unclaimed rows, well past PostgREST's default
  // 1000-row response cap — a plain .select() here silently truncates and
  // drops real matches (bit exactly this bug already once in this repo, see
  // historical_attendance_counts()'s own comment). Page through explicitly.
  const PAGE = 1000;
  const legacy: Array<{ id: string; personal_email: string | null; campus_email: string | null }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: legacyErr } = await admin
      .from("legacy_members")
      .select("id, personal_email, campus_email")
      .is("claimed_at", null)
      .range(from, from + PAGE - 1);
    if (legacyErr) throw new Error(`load legacy_members: ${legacyErr.message}`);
    legacy.push(...(page ?? []));
    if (!page || page.length < PAGE) break;
  }

  const byEmail = new Map<string, string>();
  for (const lm of legacy ?? []) {
    if (lm.personal_email) byEmail.set(lm.personal_email.toLowerCase(), lm.id);
    if (lm.campus_email) byEmail.set(lm.campus_email.toLowerCase(), lm.id);
  }

  const matches = (profiles ?? [])
    .map((p) => {
      const legacyId =
        byEmail.get((p.google_email ?? "").toLowerCase()) ??
        byEmail.get((p.student_email ?? "").toLowerCase());
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "(no name)";
      return legacyId ? { profileId: p.id, legacyId, name } : null;
    })
    .filter((m): m is { profileId: string; legacyId: string; name: string } => m !== null);

  console.log(`\nClaim backfill plan (${DRY_RUN ? "DRY RUN" : "EXECUTE"})`);
  console.log(`  Unclaimed legacy_members rows: ${legacy?.length ?? 0}`);
  console.log(`  Profiles matched by email: ${matches.length}\n`);

  if (DRY_RUN) {
    for (const m of matches) console.log(`  ${m.name} -> legacy ${m.legacyId}`);
    console.log("\n[dry-run] no writes performed.");
    return;
  }

  let updated = 0;
  const now = new Date().toISOString();
  for (const m of matches) {
    const { error } = await admin
      .from("legacy_members")
      .update({ claimed_at: now, claimed_profile_id: m.profileId })
      .eq("id", m.legacyId)
      .is("claimed_at", null); // still-null guard against a race
    if (error) {
      console.warn(`  ! failed ${m.name}: ${error.message}`);
      continue;
    }
    updated++;
  }
  console.log(`Claimed ${updated}/${matches.length} legacy_members rows.`);
}

main().catch((err) => {
  console.error("✗ backfill failed:", err);
  process.exit(1);
});
