#!/usr/bin/env tsx
// One-off import: load a Luma guest-list CSV export into legacy_members.
// Runs with service-role. Use --dry-run to preview before writing.
//
// Only approval_status="approved" rows are imported. "invited" rows in a
// Luma export are just people who were sent an invite link, most have no
// phone number and no SMS-consent response at all, they're cold contacts,
// not confirmed members. "declined" rows are explicit opt-outs. Only
// "approved" (real RSVP, real consent-checkbox answer) counts as a person
// who actually engaged.
//
// Usage:
//   pnpm tsx scripts/import-legacy-members.ts <path-to-csv> --dry-run
//   pnpm tsx scripts/import-legacy-members.ts <path-to-csv>

import { config } from "dotenv";
config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");
const csvPath = process.argv[2];

if (!csvPath || csvPath.startsWith("--")) {
  console.error("Usage: pnpm tsx scripts/import-legacy-members.ts <path-to-csv> [--dry-run]");
  process.exit(1);
}

// Minimal RFC4180 line parser: handles quoted fields with embedded commas
// and doubled "" escapes. Luma exports don't embed newlines inside quoted
// fields, so a per-line split is safe here.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

type LumaRow = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  personal_email: string | null;
  campus_email: string | null;
  phone_number: string | null;
  sms_interest: boolean | null;
  approval_status: string;
};

function normEmail(v: string | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  return t.length > 0 ? t : null;
}

// Fixes known GSU campus-email domain typos seen in the raw source data
// (missing dot, transposed letters, swapped segments). Only rewrites exact
// known-bad variants of student.gsu.edu — never guesses on anything else,
// a wrong guess here would misroute someone's account claim.
const CAMPUS_DOMAIN_TYPOS: Record<string, string> = {
  "student.gsuedu": "student.gsu.edu",
  "stduent.gsu.edu": "student.gsu.edu",
  "student.edu.gsu": "student.gsu.edu",
};
function fixCampusEmailTypo(email: string | null): string | null {
  if (!email || !email.includes("@")) return email;
  const [local, domain] = email.split("@");
  const fixed = CAMPUS_DOMAIN_TYPOS[domain];
  return fixed ? `${local}@${fixed}` : email;
}

function normText(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

async function main() {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(csvPath, "utf-8").replace(/^﻿/, ""); // strip BOM
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);

  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`CSV missing expected column: ${name}`);
    return i;
  };

  const iName = idx("name");
  const iFirst = idx("first_name");
  const iLast = idx("last_name");
  const iEmail = idx("email");
  const iPhone = idx("phone_number");
  const iStatus = idx("approval_status");
  const iGsuEmail = idx("GSU Email");
  const iSms = header.findIndex((h) => h.startsWith("By checking this box"));

  const rows: LumaRow[] = lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return {
      full_name: normText(f[iName]),
      first_name: normText(f[iFirst]),
      last_name: normText(f[iLast]),
      personal_email: normEmail(f[iEmail]),
      campus_email: fixCampusEmailTypo(normEmail(f[iGsuEmail])),
      phone_number: normText(f[iPhone]),
      sms_interest: iSms >= 0 ? normText(f[iSms]) === "Yes" : null,
      approval_status: (f[iStatus] ?? "").trim(),
    };
  });

  const byStatus = { approved: 0, invited: 0, declined: 0, other: 0 };
  for (const r of rows) {
    if (r.approval_status === "approved") byStatus.approved++;
    else if (r.approval_status === "invited") byStatus.invited++;
    else if (r.approval_status === "declined") byStatus.declined++;
    else byStatus.other++;
  }

  // Includes "invited" alongside "approved" per John's explicit call
  // (2026-08-19) — declined stays excluded, that's an explicit opt-out.
  // sms_interest is left exactly as answered (often false/null for invited
  // rows who never responded), never upgraded to true on import.
  const candidates = rows.filter(
    (r) => r.approval_status === "approved" || r.approval_status === "invited"
  );
  const missingEmail = candidates.filter(
    (r) => !r.personal_email && !r.campus_email
  );
  const toImport = candidates.filter(
    (r) => r.personal_email || r.campus_email
  );

  console.log(`\nImport plan (${DRY_RUN ? "DRY RUN" : "EXECUTE"}) — source: ${csvPath}`);
  console.log(`  Total rows:              ${rows.length}`);
  console.log(`  approved:                ${byStatus.approved}`);
  console.log(`  invited:                 ${byStatus.invited}`);
  console.log(`  declined (skipped):      ${byStatus.declined}`);
  console.log(`  other status (skipped):  ${byStatus.other}`);
  console.log(`  approved/invited w/ no email (skipped): ${missingEmail.length}`);
  console.log(`  To import:               ${toImport.length}\n`);

  if (DRY_RUN) {
    for (const r of toImport) {
      console.log(`  ${r.full_name}  personal=${r.personal_email ?? "-"}  campus=${r.campus_email ?? "-"}  sms=${r.sms_interest}`);
    }
    console.log("\n[dry-run] no writes performed.");
    return;
  }

  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let inserted = 0;
  let skippedDup = 0;
  for (const r of toImport) {
    const { error } = await admin.from("legacy_members").insert({
      full_name: r.full_name,
      first_name: r.first_name,
      last_name: r.last_name,
      personal_email: r.personal_email,
      campus_email: r.campus_email,
      phone_number: r.phone_number,
      sms_interest: r.sms_interest,
      source: "luma_export",
      source_detail: csvPath.split("/").pop(),
    });
    if (error) {
      if (error.code === "23505") {
        skippedDup++;
        continue;
      }
      console.warn(`  ! failed ${r.full_name}: ${error.message}`);
      continue;
    }
    inserted++;
  }
  console.log(`Inserted ${inserted}, skipped ${skippedDup} duplicate(s).`);
}

main().catch((e) => {
  console.error("import-legacy-members:", e);
  process.exit(1);
});
