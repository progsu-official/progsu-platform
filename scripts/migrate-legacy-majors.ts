#!/usr/bin/env tsx
// One-off backfill: map existing profiles.major free-text strings to a
// majors.slug value. Runs with service-role. Use --dry-run to preview.
//
// Heuristic matching:
//   1. Exact case-insensitive match against majors.label (after trimming +
//      collapsing "CS" / "IT" / common abbreviations).
//   2. Normalized slug match (lowercase, non-alpha -> _) against majors.slug.
//   3. Fallback: major='other', major_other_text=<original string>.
//
// Anything that falls through to the fallback is logged so an admin can
// curate. The script is idempotent — re-running on already-slug values is a
// no-op because they match in step 2.
//
// Usage:
//   pnpm tsx scripts/migrate-legacy-majors.ts            # execute
//   pnpm tsx scripts/migrate-legacy-majors.ts --dry-run  # preview only

import { config } from "dotenv";
config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");

// Manual alias table — cheaper than fuzzy matching and less surprising.
// Keep lowercase; leading/trailing whitespace is trimmed before lookup.
const ALIAS: Record<string, string> = {
  // Computer Science
  "cs": "computer_science",
  "comp sci": "computer_science",
  "comp. sci.": "computer_science",
  "computer sci": "computer_science",
  // CIS
  "cis": "computer_information_systems",
  "mis": "computer_information_systems",
  // Software engineering
  "swe": "software_engineering",
  "soft eng": "software_engineering",
  "software eng": "software_engineering",
  // Data
  "ds": "data_science",
  "data sci": "data_science",
  // Math / stats
  "math": "mathematics",
  "stats": "statistics",
  "stat": "statistics",
  // Engineering abbreviations
  "me": "mechanical_engineering",
  "mech eng": "mechanical_engineering",
  "mech e": "mechanical_engineering",
  "ee": "electrical_engineering",
  "elec eng": "electrical_engineering",
  "ce": "civil_engineering",
  "civ eng": "civil_engineering",
  // Business
  "econ": "economics",
  "bus mgmt": "management",
  "management": "management",
  "entrepreneurship": "management",
  // Social sciences / arts
  "poli sci": "political_science",
  "polisci": "political_science",
  "psych": "psychology",
  "comms": "communications",
  "comm": "communications",
  // Health
  "ph": "public_health",
  "bsn": "nursing",
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type MajorRow = { slug: string; label: string; is_active: boolean };

function matchMajor(raw: string, majors: MajorRow[]): string | null {
  const norm = normalize(raw);
  if (!norm) return null;

  // 1. Alias lookup.
  if (ALIAS[norm]) return ALIAS[norm];

  // 2. Exact label match (case-insensitive).
  const byLabel = majors.find((m) => m.label.toLowerCase() === norm);
  if (byLabel) return byLabel.slug;

  // 3. Normalized slug match.
  const slug = slugify(raw);
  const bySlug = majors.find((m) => m.slug === slug);
  if (bySlug) return bySlug.slug;

  // 4. Partial label match — only if exactly one major's label contains the
  //    input as a whole word. Avoids "bio" matching both "biology" and
  //    "biochemistry" if we add more later.
  const words = norm.split(/\s+/).filter(Boolean);
  const partials = majors.filter((m) => {
    const ml = m.label.toLowerCase();
    return words.every((w) => ml.includes(w));
  });
  if (partials.length === 1) return partials[0].slug;

  return null;
}

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data: majorRows, error: majorsErr } = await admin
    .from("majors")
    .select("slug, label, is_active");
  if (majorsErr) throw new Error(`fetch majors: ${majorsErr.message}`);
  const majors = (majorRows ?? []) as MajorRow[];
  if (majors.length === 0) {
    throw new Error("majors table is empty — apply migration 20260427000100 first");
  }

  const { data: profileRows, error: profilesErr } = await admin
    .from("profiles")
    .select("id, first_name, last_name, major, major_other_text");
  if (profilesErr) throw new Error(`fetch profiles: ${profilesErr.message}`);
  const profiles = (profileRows ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    major: string | null;
    major_other_text: string | null;
  }>;

  const plan = {
    alreadySlug: 0,
    matched: [] as Array<{ id: string; from: string; to: string }>,
    unmatched: [] as Array<{ id: string; from: string; name: string }>,
    nullMajor: 0,
  };

  for (const p of profiles) {
    if (!p.major) {
      plan.nullMajor++;
      continue;
    }
    // Already a slug? Fast exit.
    if (majors.some((m) => m.slug === p.major)) {
      plan.alreadySlug++;
      continue;
    }
    const slug = matchMajor(p.major, majors);
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "(unnamed)";
    if (slug) {
      plan.matched.push({ id: p.id, from: p.major, to: slug });
    } else {
      plan.unmatched.push({ id: p.id, from: p.major, name });
    }
  }

  console.log(`\nBackfill plan (${DRY_RUN ? "DRY RUN" : "EXECUTE"})`);
  console.log(`  Total profiles:     ${profiles.length}`);
  console.log(`  Already slug:       ${plan.alreadySlug}`);
  console.log(`  Null major:         ${plan.nullMajor}`);
  console.log(`  Matched → slug:     ${plan.matched.length}`);
  console.log(`  Unmatched → other:  ${plan.unmatched.length}\n`);

  if (plan.matched.length > 0) {
    console.log("Matches:");
    for (const m of plan.matched) {
      console.log(`  ${m.id}  "${m.from}" → ${m.to}`);
    }
    console.log();
  }

  if (plan.unmatched.length > 0) {
    console.log("Unmatched (will be set to major='other' with major_other_text preserving original):");
    for (const u of plan.unmatched) {
      console.log(`  ${u.id}  ${u.name}  "${u.from}"`);
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("[dry-run] no writes performed.");
    return;
  }

  // Write. One UPDATE per row; 40 rows is not worth a batch helper.
  let applied = 0;
  for (const m of plan.matched) {
    const { error } = await admin
      .from("profiles")
      .update({ major: m.to, major_other_text: null })
      .eq("id", m.id);
    if (error) {
      console.warn(`  ! failed ${m.id}: ${error.message}`);
      continue;
    }
    applied++;
  }
  for (const u of plan.unmatched) {
    const { error } = await admin
      .from("profiles")
      .update({ major: "other", major_other_text: u.from })
      .eq("id", u.id);
    if (error) {
      console.warn(`  ! failed ${u.id}: ${error.message}`);
      continue;
    }
    applied++;
  }
  console.log(`Applied ${applied} update(s).`);
}

main().catch((e) => {
  console.error("migrate-legacy-majors:", e);
  process.exit(1);
});
