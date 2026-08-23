#!/usr/bin/env tsx
// One-off: backfill missing historical_event_attendances rows for an
// already-existing event from a fresh, individually-downloaded Luma
// guest-list CSV export.
//
// Why this exists instead of reusing import-historical-events.ts: that
// script parses a single combined Google Sheet (multiple events'
// exports stacked with title-row separators) using FIXED column indices,
// which assumes every pasted export has the exact same column layout.
// 2026-08-22 audit found 4 events (of 7 checked) where the DB only has the
// checked-in subset of attendees, not the full approved list — the sheet's
// pasted snapshot for those 4 was apparently taken mid-event rather than a
// full post-event export. This script re-parses by HEADER NAME (robust to
// column-order/count differences) against a fresh per-event export, and
// upserts through the exact same legacy_members/historical_event_attendances
// pattern the combined-sheet script already uses — safe to re-run on an
// already-correct event too, since the attendance upsert is keyed on
// (event_id, legacy_member_id) and just no-ops/updates, never duplicates.
//
// Usage:
//   pnpm tsx scripts/backfill-historical-attendance-gap.ts <csv-path> <event-id> --dry-run
//   pnpm tsx scripts/backfill-historical-attendance-gap.ts <csv-path> <event-id>

import { config } from "dotenv";
config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");
const csvPath = process.argv[2];
const eventId = process.argv[3];

if (!csvPath || !eventId || csvPath.startsWith("--") || eventId.startsWith("--")) {
  console.error(
    "Usage: pnpm tsx scripts/backfill-historical-attendance-gap.ts <csv-path> <event-id> [--dry-run]"
  );
  process.exit(1);
}

// Same minimal RFC4180 parser as import-legacy-members.ts.
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

function nz(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

async function main() {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(csvPath, "utf-8").replace(/^﻿/, "");
  // Luma's multi-line quoted custom-question headers (e.g. the SMS-consent
  // checkbox text) mean a naive split("\n") breaks mid-header. Rows
  // themselves don't contain embedded newlines in these exports, only the
  // header does, so only the header needs the quote-aware join.
  const rawLines = raw.split("\n");
  let headerLine = rawLines[0];
  let bodyStart = 1;
  let quoteCount = (headerLine.match(/"/g) ?? []).length;
  while (quoteCount % 2 !== 0 && bodyStart < rawLines.length) {
    headerLine += "\n" + rawLines[bodyStart];
    quoteCount += (rawLines[bodyStart].match(/"/g) ?? []).length;
    bodyStart++;
  }
  const header = parseCsvLine(headerLine);
  const lines = rawLines.slice(bodyStart).filter((l) => l.trim().length > 0);

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
  const iCreatedAt = idx("created_at");
  const iStatus = idx("approval_status");
  const iCheckedInAt = idx("checked_in_at");
  const iTicketName = header.indexOf("ticket_name"); // optional, cosmetic

  type Row = {
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    createdAt: string | null;
    approvalStatus: string | null;
    checkedInAt: string | null;
    ticketName: string | null;
  };

  const rows: Row[] = lines.map((line) => {
    const f = parseCsvLine(line);
    return {
      fullName: nz(f[iName]),
      firstName: nz(f[iFirst]),
      lastName: nz(f[iLast]),
      email: nz(f[iEmail])?.toLowerCase() ?? null,
      phone: nz(f[iPhone]),
      createdAt: nz(f[iCreatedAt]),
      approvalStatus: nz(f[iStatus]),
      checkedInAt: nz(f[iCheckedInAt]),
      ticketName: iTicketName >= 0 ? nz(f[iTicketName]) : null,
    };
  });

  // Only "approved" — this is an ATTENDANCE record, not the broader
  // people-directory import (import-legacy-members.ts intentionally also
  // keeps "invited" as cold contacts, but someone merely invited never
  // registered or went; admin_event_roster_for's own status mapping only
  // ever recognizes 'approved' -> 'going', "invited" has no defined meaning
  // there and would show as a broken/null-status roster row).
  const candidates = rows.filter((r) => r.email && r.approvalStatus === "approved");

  console.log(`\nBackfill plan (${DRY_RUN ? "DRY RUN" : "EXECUTE"})`);
  console.log(`  Source:        ${csvPath}`);
  console.log(`  Target event:  ${eventId}`);
  console.log(`  Total rows:    ${rows.length}`);
  console.log(`  Candidates:    ${candidates.length} (approved, has email)\n`);

  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: eventRow, error: eventErr } = await admin
    .from("events")
    .select("id, title")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !eventRow) {
    throw new Error(`event ${eventId} not found: ${eventErr?.message ?? "no row"}`);
  }
  console.log(`  Target event title: "${eventRow.title}"\n`);

  const { data: existingAtt } = await admin
    .from("historical_event_attendances")
    .select("legacy_member_id")
    .eq("event_id", eventId);
  const alreadyLinkedCount = existingAtt?.length ?? 0;

  const { data: domainRows, error: domainErr } = await admin
    .from("school_domains")
    .select("domain")
    .eq("is_active", true);
  if (domainErr) throw new Error(`school_domains lookup failed: ${domainErr.message}`);
  const campusDomains = new Set((domainRows ?? []).map((d) => (d.domain as string).toLowerCase()));
  const emailDomain = (email: string) => email.slice(email.indexOf("@") + 1).toLowerCase();

  if (DRY_RUN) {
    console.log(`  Already linked to this event: ${alreadyLinkedCount}`);
    console.log(`  Would upsert (create-or-match + link): ${candidates.length}\n`);
    for (const r of candidates.slice(0, 20)) {
      console.log(`    ${r.fullName ?? "?"}  <${r.email}>  status=${r.approvalStatus}  checked_in=${r.checkedInAt ? "yes" : "no"}`);
    }
    if (candidates.length > 20) console.log(`    ... and ${candidates.length - 20} more`);
    console.log("\n[dry-run] no writes performed.");
    return;
  }

  let legacyCreated = 0;
  let legacyMatched = 0;
  let attendanceUpserted = 0;
  const legacyIdByEmail = new Map<string, string>();

  for (const r of candidates) {
    const email = r.email as string;
    let legacyId = legacyIdByEmail.get(email);
    if (!legacyId) {
      const isCampus = campusDomains.has(emailDomain(email));
      const emailCol = isCampus ? "campus_email" : "personal_email";

      const { data: existing } = await admin
        .from("legacy_members")
        .select("id")
        .eq(emailCol, email)
        .maybeSingle();

      if (existing) {
        legacyId = existing.id;
        legacyMatched++;
      } else {
        const fullName =
          r.fullName ?? ([r.firstName, r.lastName].filter(Boolean).join(" ") || null);
        const { data: inserted, error: insertErr } = await admin
          .from("legacy_members")
          .insert({
            full_name: fullName,
            first_name: r.firstName,
            last_name: r.lastName,
            personal_email: isCampus ? null : email,
            campus_email: isCampus ? email : null,
            phone_number: r.phone,
            source: "luma_export",
            source_detail: eventRow.title,
          })
          .select("id")
          .single();
        if (insertErr) {
          if (insertErr.code === "23505") {
            const { data: retryFound } = await admin
              .from("legacy_members")
              .select("id")
              .eq(emailCol, email)
              .maybeSingle();
            if (!retryFound) {
              console.warn(`  ! legacy_members conflict-retry failed for ${email}`);
              continue;
            }
            legacyId = retryFound.id;
          } else {
            console.warn(`  ! legacy_members insert failed for ${email}: ${insertErr.message}`);
            continue;
          }
        } else {
          legacyId = inserted.id;
          legacyCreated++;
        }
      }
      legacyIdByEmail.set(email, legacyId!);
    }

    const { error: attErr } = await admin
      .from("historical_event_attendances")
      .upsert(
        {
          event_id: eventId,
          legacy_member_id: legacyId,
          registered_at: r.createdAt,
          approval_status: r.approvalStatus,
          checked_in_at: r.checkedInAt,
          ticket_name: r.ticketName,
          source_detail: eventRow.title,
        },
        { onConflict: "event_id,legacy_member_id" }
      );
    if (attErr) {
      console.warn(`  ! attendance upsert failed for ${email}: ${attErr.message}`);
      continue;
    }
    attendanceUpserted++;
  }

  console.log(`Legacy members created: ${legacyCreated}, matched existing: ${legacyMatched}`);
  console.log(`Attendance rows upserted: ${attendanceUpserted}`);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
