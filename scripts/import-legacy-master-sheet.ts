#!/usr/bin/env tsx
// One-off import: load rows from "MASTER: 2025-2026 Events + Attendance"
// (a multi-tab Google Sheet already fetched to a local text dump, see
// argv[2]) into legacy_members. Unlike the Luma import, this sheet has no
// "approved" concept, every row already represents a real action (attended,
// signed up, or filled out the interest form) so nothing gets excluded on
// that basis. What DOES get excluded:
//   - two tabs that aren't member data at all: the event log (no people)
//     and the raw attendance-debug/Twilio SMS log tabs, never parsed here.
//   - rows that are test/debug data mixed into otherwise-real tables
//     (test1-5@student.gsu.edu, TEST001-003, "test 5" name variants).
//   - rows with no name and no email at all (blank spacer rows).
// One tab ("Join Date | Student Name | Role | Campus Email | Phone # |
// SMS Opt-In | Phone number | Personal email address | Must end with
// '.edu'") has a real column-mapping bug in the source form: the actual
// name/phone/email values sit under headers that don't describe them.
// Parsed positionally against the verified real layout, not the header text.
//
// Usage:
//   pnpm tsx scripts/import-legacy-master-sheet.ts <path-to-dump> --dry-run
//   pnpm tsx scripts/import-legacy-master-sheet.ts <path-to-dump>

import { config } from "dotenv";
config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");
const dumpPath = process.argv[2];

if (!dumpPath || dumpPath.startsWith("--")) {
  console.error("Usage: pnpm tsx scripts/import-legacy-master-sheet.ts <path-to-dump> [--dry-run]");
  process.exit(1);
}

type Row = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  personal_email: string | null;
  campus_email: string | null;
  phone_number: string | null;
  sms_interest: boolean | null;
  source_detail: string;
};

function unescapeMd(cell: string): string {
  return cell.replace(/\\([#\-!.\\+*_&~>])/g, "$1").trim();
}

function parseCells(line: string): string[] {
  const parts = line.split("|");
  // Markdown table rows start and end with "|", so first/last split are artifacts.
  return parts.slice(1, -1).map(unescapeMd);
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const sp = full.indexOf(" ");
  if (sp === -1) return { first: full, last: null };
  return { first: full.slice(0, sp), last: full.slice(sp + 1).trim() || null };
}

function nz(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
}

function emailNz(s: string | undefined): string | null {
  const t = nz(s);
  return t ? t.toLowerCase() : null;
}

// Finds a table by a distinctive substring in its header row, then collects
// rows until the next blank line (markdown table boundary in this dump).
function extractTable(lines: string[], headerMarker: string): string[] {
  const headerIdx = lines.findIndex((l) => l.includes(headerMarker));
  if (headerIdx === -1) {
    console.warn(`  ! table header not found: "${headerMarker}"`);
    return [];
  }
  const dataLines: string[] = [];
  // headerIdx+1 is the markdown separator row (":-:|:-:|..."), skip it.
  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (lines[i].trim() === "") break;
    if (!lines[i].startsWith("|")) break;
    dataLines.push(lines[i]);
  }
  return dataLines;
}

// The club's own shared account, shows up a few times as a self-test signup,
// not a real member.
const ORG_SHARED_EMAILS = new Set(["programmingclubatgsu@gmail.com"]);

function isTestRow(r: Row): boolean {
  const emailIsTest = (e: string | null) =>
    !!e && (/^test\d*@|^test@/i.test(e) || ORG_SHARED_EMAILS.has(e));
  const nameIsTest = (n: string | null) => !!n && /\btest\b/i.test(n);
  return (
    emailIsTest(r.personal_email) ||
    emailIsTest(r.campus_email) ||
    nameIsTest(r.full_name)
  );
}

async function main() {
  const fs = await import("node:fs");
  const text = fs.readFileSync(dumpPath, "utf-8");
  const lines = text.split("\n");

  const allRows: Row[] = [];

  // Table 1: attendance roster. No phone/personal email in this tab.
  for (const line of extractTable(lines, "Panther ID | Discord | Notes")) {
    const c = parseCells(line);
    const [, , , , studentName, campusEmail, sms, ,] = c;
    const full_name = nz(studentName);
    if (!full_name && !emailNz(campusEmail)) continue;
    const { first, last } = splitName(full_name);
    allRows.push({
      full_name,
      first_name: first,
      last_name: last,
      personal_email: null,
      campus_email: emailNz(campusEmail),
      phone_number: null,
      sms_interest: sms?.trim() === "Yes",
      source_detail: "master_sheet:attendance_roster",
    });
  }

  // Table 2: membership signup, correctly labeled columns.
  for (const line of extractTable(lines, "Panther ID | Discord | Email")) {
    const c = parseCells(line);
    const [, studentName, , campusEmail, phone, sms, , , personalEmail] = c;
    const full_name = nz(studentName);
    if (!full_name && !emailNz(campusEmail) && !emailNz(personalEmail)) continue;
    const { first, last } = splitName(full_name);
    allRows.push({
      full_name,
      first_name: first,
      last_name: last,
      personal_email: emailNz(personalEmail),
      campus_email: emailNz(campusEmail),
      phone_number: nz(phone),
      sms_interest: sms?.trim() === "Yes",
      source_detail: "master_sheet:membership_join_1",
    });
  }

  // Table 3: membership signup, BROKEN column mapping in the source form.
  // Verified real layout: cells[4]=first_name, cells[5]=last_name,
  // cells[6]=phone, cells[7]=personal_email. Headers here do not describe
  // the real values, parsed positionally instead.
  for (const line of extractTable(lines, "Must end with '.edu'")) {
    const c = parseCells(line);
    const first = nz(c[4]);
    const last = nz(c[5]);
    const phone = nz(c[6]);
    const personalEmail = emailNz(c[7]);
    // Despite sitting under the "Must end with '.edu'" header, this column
    // holds the real campus email in most rows, verified against source
    // (e.g. John Sang's row has jsang2@student.gsu.edu here). Blank in a
    // handful of the earliest entries only.
    const campusEmail = emailNz(c[8]);
    if (!first && !last && !personalEmail && !campusEmail) continue;
    allRows.push({
      full_name: [first, last].filter(Boolean).join(" ") || null,
      first_name: first,
      last_name: last,
      personal_email: personalEmail,
      campus_email: campusEmail,
      phone_number: phone,
      sms_interest: null,
      source_detail: "master_sheet:membership_join_2_broken_cols",
    });
  }

  // Table 4: per-event attendance form.
  for (const line of extractTable(lines, "SMS Opt-In Yes/No | Email")) {
    const c = parseCells(line);
    const [, , studentName, , campusEmail, phone, sms, personalEmail] = c;
    const full_name = nz(studentName);
    if (!full_name && !emailNz(campusEmail) && !emailNz(personalEmail)) continue;
    const { first, last } = splitName(full_name);
    allRows.push({
      full_name,
      first_name: first,
      last_name: last,
      personal_email: emailNz(personalEmail),
      campus_email: emailNz(campusEmail),
      phone_number: nz(phone),
      sms_interest: sms?.trim() === "Yes",
      source_detail: "master_sheet:event_attendance_form",
    });
  }

  // Table 5: attendance-form processing log. Heavy test contamination,
  // filtered same as everything else, real rows kept.
  for (const line of extractTable(lines, "Event ID Attended (Pre-Filled)")) {
    const c = parseCells(line);
    const [, , fullName, campusEmail, phone, sms] = c;
    const full_name = nz(fullName);
    if (!full_name && !emailNz(campusEmail)) continue;
    const { first, last } = splitName(full_name);
    allRows.push({
      full_name,
      first_name: first,
      last_name: last,
      personal_email: null,
      campus_email: emailNz(campusEmail),
      phone_number: nz(phone),
      sms_interest: nz(sms) !== null,
      source_detail: "master_sheet:attendance_processing_log",
    });
  }

  // Table 6: general interest form (the one that was empty as a standalone
  // Drive file, this copy inside the master sheet has real responses).
  for (const line of extractTable(lines, "Which events are you interested in?")) {
    const c = parseCells(line);
    const [, fullName, , campusEmail, phone, sms] = c;
    const full_name = nz(fullName);
    if (!full_name && !emailNz(campusEmail)) continue;
    const { first, last } = splitName(full_name);
    allRows.push({
      full_name,
      first_name: first,
      last_name: last,
      personal_email: emailNz(campusEmail)?.includes("@gmail") ? emailNz(campusEmail) : null,
      campus_email: emailNz(campusEmail),
      phone_number: nz(phone),
      sms_interest: nz(sms) !== null,
      source_detail: "master_sheet:general_interest_form",
    });
  }

  const beforeTestFilter = allRows.length;
  const realRows = allRows.filter((r) => !isTestRow(r));
  const testFiltered = beforeTestFilter - realRows.length;

  // Dedupe across all tabs. A person can appear under only their campus
  // email in one tab and only their personal email in another, with no row
  // ever showing both, so a plain "group by one key" pass would miss that
  // they're the same person (this is exactly what happened to John Sang's
  // own data: split into two rows, one per email type). Union-find instead:
  // any row carrying two emails links those two emails as the same person,
  // even if that linking row isn't the first or only row for either email.
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p !== x) {
      const root = find(p);
      parent.set(x, root);
      return root;
    }
    return x;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  let noEmail = 0;
  for (const r of realRows) {
    const emails = [r.campus_email, r.personal_email].filter(
      (e): e is string => !!e
    );
    if (emails.length === 0) {
      noEmail++;
      continue;
    }
    for (const e of emails) find(e); // register
    if (emails.length === 2) union(emails[0], emails[1]);
  }

  const byRoot = new Map<string, Row>();
  for (const r of realRows) {
    const emails = [r.campus_email, r.personal_email].filter(
      (e): e is string => !!e
    );
    if (emails.length === 0) continue;
    const root = find(emails[0]);
    const existing = byRoot.get(root);
    if (!existing) {
      byRoot.set(root, r);
    } else {
      byRoot.set(root, {
        full_name: existing.full_name ?? r.full_name,
        first_name: existing.first_name ?? r.first_name,
        last_name: existing.last_name ?? r.last_name,
        personal_email: existing.personal_email ?? r.personal_email,
        campus_email: existing.campus_email ?? r.campus_email,
        phone_number: existing.phone_number ?? r.phone_number,
        sms_interest: existing.sms_interest ?? r.sms_interest,
        source_detail: existing.source_detail,
      });
    }
  }
  const deduped = Array.from(byRoot.values());

  console.log(`\nImport plan (${DRY_RUN ? "DRY RUN" : "EXECUTE"}) — source: ${dumpPath}`);
  console.log(`  Raw rows extracted across 6 tabs: ${beforeTestFilter}`);
  console.log(`  Test/debug rows filtered:         ${testFiltered}`);
  console.log(`  No email at all (skipped):        ${noEmail}`);
  console.log(`  Unique people after de-dup:       ${deduped.length}\n`);

  if (DRY_RUN) {
    for (const r of deduped.slice(0, 15)) {
      console.log(`  ${r.full_name ?? "(no name)"}  campus=${r.campus_email ?? "-"}  personal=${r.personal_email ?? "-"}  [${r.source_detail}]`);
    }
    console.log(`  ... (${deduped.length} total)`);
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
  for (const r of deduped) {
    const { error } = await admin.from("legacy_members").insert({
      full_name: r.full_name,
      first_name: r.first_name,
      last_name: r.last_name,
      personal_email: r.personal_email,
      campus_email: r.campus_email,
      phone_number: r.phone_number,
      sms_interest: r.sms_interest,
      source: "master_sheet_2025_2026",
      source_detail: r.source_detail,
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
  console.error("import-legacy-master-sheet:", e);
  process.exit(1);
});
