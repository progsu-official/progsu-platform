// Asserts import-legacy-members.ts against a small fixture CSV: correct
// approved/invited/declined split, no test-row contamination, no duplicate
// emails land in the table.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const FIXTURE_PATH = "/tmp/smoke-legacy-import-fixture.csv";

const FIXTURE_CSV = `guest_id,name,first_name,last_name,email,phone_number,created_at,approval_status,checked_in_at,utm_source,referrer,referred_by,qr_code_url,amount,amount_tax,amount_discount,currency,coupon_code,eth_address,solana_address,survey_response_rating,survey_response_feedback,ticket_type_id,ticket_name,GSU Email,"By checking this box, I agree to allow PROGSU to send me SMS alerts related to future events and activities.",I have filled out this interest form carefully: https://forms.gle/x
gst-1,Test Approved,Test,Approved,tapproved@gmail.com,+14045551111,2026-04-09T20:18:25.760Z,approved,,,,,https://luma.com/x,$0.00,,,usd,,,,,,evtticktyp-x,Standard,tapproved1@student.gsu.edu,Yes,Yes
gst-2,Test Invited,Test,Invited,tinvited@gmail.com,,2026-04-09T20:18:25.760Z,invited,,,,,https://luma.com/x,,,,,,,,,,,,,,,
gst-3,Test Declined,Test,Declined,tdeclined@gmail.com,+14045551112,2026-04-09T20:18:25.760Z,declined,,,,,https://luma.com/x,,,,,,,,,,,,,tdeclined1@student.gsu.edu,Yes,Yes
`;

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  writeFileSync(FIXTURE_PATH, FIXTURE_CSV);
  try {
    await admin.from("legacy_members").delete().eq("personal_email", "tapproved@gmail.com");

    await admin.from("legacy_members").delete().eq("personal_email", "tinvited@gmail.com");

    const run = spawnSync("pnpm", ["tsx", "scripts/import-legacy-members.ts", FIXTURE_PATH], {
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error(`import failed: ${run.stderr}`);
    // approved + invited both import (2026-08-19 change); declined stays excluded.
    if (!run.stdout.includes("Inserted 2, skipped 0"))
      throw new Error(`unexpected import summary: ${run.stdout}`);
    console.log("  ✓ approved + invited rows imported, declined skipped");

    const { data: invitedRow, error: invitedErr } = await admin
      .from("legacy_members")
      .select("sms_interest, campus_email")
      .eq("personal_email", "tinvited@gmail.com")
      .single();
    if (invitedErr || !invitedRow) throw new Error(`invited row missing: ${invitedErr?.message}`);
    if (invitedRow.sms_interest !== false)
      throw new Error(`invited row's unanswered SMS field must not be fabricated true: ${invitedRow.sms_interest}`);
    console.log("  ✓ invited row's SMS consent stays honest (never upgraded to true)");

    const { data, error } = await admin
      .from("legacy_members")
      .select("full_name, personal_email, campus_email, sms_interest, claimed_at")
      .eq("personal_email", "tapproved@gmail.com")
      .single();
    if (error || !data) throw new Error(`row missing after import: ${error?.message}`);
    if (data.campus_email !== "tapproved1@student.gsu.edu")
      throw new Error(`campus_email mismatch: ${data.campus_email}`);
    if (data.sms_interest !== true) throw new Error(`sms_interest should be true`);
    if (data.claimed_at !== null) throw new Error(`claimed_at should start null`);
    console.log("  ✓ imported row has correct fields, unclaimed");

    const rerun = spawnSync("pnpm", ["tsx", "scripts/import-legacy-members.ts", FIXTURE_PATH], {
      encoding: "utf8",
    });
    if (!rerun.stdout.includes("Inserted 0, skipped 2"))
      throw new Error(`re-run should skip both as duplicates: ${rerun.stdout}`);
    console.log("  ✓ re-running the import is idempotent (both duplicate emails skipped)");

    console.log("✓ legacy-import smoke OK");
  } finally {
    unlinkSync(FIXTURE_PATH);
    await admin.from("legacy_members").delete().eq("personal_email", "tapproved@gmail.com");
    await admin.from("legacy_members").delete().eq("personal_email", "tinvited@gmail.com");
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
