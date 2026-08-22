#!/usr/bin/env tsx
// One-off import: historical (pre-platform) event attendance from the
// "Combined Attendance" Google Sheet — a stack of raw Luma per-event
// guest-list exports pasted one after another. Each export is preceded by a
// single-cell title row ("<event name> - Guests - YYYY-MM-DD-HH-MM-SS") and
// the fixed Luma header row (api_id, name, first_name, last_name, email,
// phone_number, created_at, approval_status, checked_in_at, ...). The same
// event can appear as multiple snapshots (re-exported as more people
// RSVP'd) — those get merged into one `events` row, using the latest
// snapshot's timestamp as the event date (a proxy, not the real start time
// — admins can correct via the normal edit UI same as any event).
//
// For each merged event: upsert one `events` row (import_source =
// 'legacy_luma_import'), upsert each attendee's identity into
// legacy_members (matched by email, never duplicated — same table the
// non-dupe-individual count already reads from), then link (event,
// identity) via historical_event_attendances. approval_status='approved'
// maps to the live platform's "going"; checked_in_at not null maps to
// "attended" (confirmed mapping, see supabase/migrations/20260821030000_*).
//
// Usage:
//   pnpm tsx scripts/import-historical-events.ts --dry-run
//   pnpm tsx scripts/import-historical-events.ts

import { config } from "dotenv";
config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");
const SPREADSHEET_ID = "1I9Vh8je61pqPp1zgXDZ82DSJ9O-fx70PEecE9xxmw18";
const SHEET_TAB = "Combined Attendance";

// The sheet's own timestamps are almost all a single bulk-export day
// (2026-04-21 or 2026-04-26), not the real event date — someone exported
// every Luma guest list at once. Cross-referenced against Drive (event log,
// per-event folders, recap docs) to find the real date for events where the
// evidence was solid enough to trust; low/no-evidence events keep the
// export-date fallback rather than risk a wrong-but-plausible-looking date.
// Times are local (America/New_York) offsets, approximate.
const REAL_DATE_OVERRIDES: Record<string, string> = {
  "100$ tournament x kickoff": "2025-09-25T18:00:00-04:00", // Event Log GBM001
  "gitpaid – weekly series kickoff event by @progsu": "2025-10-01T17:00:00-04:00", // Event Log GP001
  "buildnight x $1000 challenge": "2025-10-07T18:00:00-04:00", // Fall 25 buildnight/startup-nights series
  "startupnights x $1000 challenge": "2025-10-07T18:00:00-04:00", // same series
  "buildnights x $1000 challenge": "2025-10-07T18:00:00-04:00", // same series
  "fanduel_ recruiting x pingpong tournament": "2025-11-13T16:00:00-05:00", // Fanduel recap doc, 237 RSVPs matches guest count exactly
  "$150 tournament x kickoff": "2026-02-06T18:00:00-05:00", // earlier standalone export, closer to real date than the April bulk re-export
  "$500 ai ideathon [feb 23] @ tech square": "2026-02-23T12:00:00-05:00", // event name itself states the date
  "crack the code (leetcode + interview prep)": "2026-03-28T08:00:00-04:00", // same day as Hacklanta (HJ001)
  "hacktlanta resume workshop": "2026-03-28T08:00:00-04:00", // same day as Hacklanta (HJ001)
  "mercedes internship w- nina sadler talent acquisition": "2026-03-28T08:00:00-04:00", // Event Log P001A/B/C exact name match
  "eboard interest meeting": "2026-04-14T00:00:00-04:00", // Drive folder "S26 - 4/14/2026 Exec Interest Meeting"
  "progirls_ loop & lounge": "2026-04-16T15:00:00-04:00", // Event Log PG001 "Progirls Launch Mocktails"
};
const LUMA_HEADER_FIRST_CELL = "api_id";

// Luma header column indices (fixed, verified against the real export).
const COL = {
  name: 1,
  firstName: 2,
  lastName: 3,
  email: 4,
  phone: 5,
  createdAt: 6,
  approvalStatus: 7,
  checkedInAt: 8,
  ticketName: 21,
};

type GuestRow = {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  createdAt: string | null;
  approvalStatus: string | null;
  checkedInAt: string | null;
  ticketName: string | null;
};

type MergedEvent = {
  eventName: string;
  latestDate: string; // ISO
  slug: string;
  guests: GuestRow[];
};

function nz(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
}

// Same Google-Sheets-numeric-coercion artifact already handled in
// import-legacy-master-sheet.ts (a plain-text phone number typed into a
// cell that looks numeric enough exports as "14045551234.0").
function phoneNz(s: string | undefined): string | null {
  const t = nz(s);
  return t ? t.replace(/\.0$/, "") : null;
}

// Luma lets you export a filtered tab ("Approved", "Checked In") instead of
// the full guest list, which prepends a status word before the timestamp —
// that's metadata about which subset got exported, not ground truth (the
// per-row approval_status/checked_in_at columns are the ground truth
// regardless), so it's captured and discarded. A trailing " N" marks a
// re-export of the same snapshot, also discarded.
const TITLE_RE =
  /^(.*?)\s*-\s*Guests\s*-\s*(?:[a-z_]+\s*-\s*)?(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})(?:\s+\d+)?$/i;

function parseTitle(title: string): { eventName: string; eventDate: string } | null {
  const m = TITLE_RE.exec(title.trim());
  if (!m) return null;
  const [, name, date, hh, mm, ss] = m;
  return { eventName: name.trim(), eventDate: `${date}T${hh}:${mm}:${ss}Z` };
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "event"
  );
}

type Segment = { eventName: string; eventDate: string; guests: GuestRow[] };

function segmentRows(rows: string[][]): { segments: Segment[]; skippedNoEmail: number; unparsedTitles: string[] } {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let skippedNoEmail = 0;
  const unparsedTitles: string[] = [];

  for (const row of rows) {
    const nonEmpty = row.filter((c) => nz(c) !== null);
    const looksLikeTitle = nonEmpty.length === 1 && row[0] !== LUMA_HEADER_FIRST_CELL;

    if (looksLikeTitle) {
      const title = nonEmpty[0];
      const parsed = parseTitle(title);
      if (!parsed) {
        unparsedTitles.push(title);
        current = null;
        continue;
      }
      current = { eventName: parsed.eventName, eventDate: parsed.eventDate, guests: [] };
      segments.push(current);
      continue;
    }

    if (row[0] === LUMA_HEADER_FIRST_CELL) continue; // Luma header row
    if (!current) continue; // stray row before any recognized title

    const email = nz(row[COL.email])?.toLowerCase();
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    current.guests.push({
      name: nz(row[COL.name]),
      firstName: nz(row[COL.firstName]),
      lastName: nz(row[COL.lastName]),
      email,
      phone: phoneNz(row[COL.phone]),
      createdAt: nz(row[COL.createdAt]),
      approvalStatus: nz(row[COL.approvalStatus]),
      checkedInAt: nz(row[COL.checkedInAt]),
      ticketName: nz(row[COL.ticketName]),
    });
  }

  return { segments, skippedNoEmail, unparsedTitles };
}

function mergeByEventName(segments: Segment[]): MergedEvent[] {
  const byName = new Map<string, MergedEvent>();
  for (const seg of segments) {
    const key = seg.eventName.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, {
        eventName: seg.eventName,
        latestDate: seg.eventDate,
        slug: `${slugify(seg.eventName)}-${seg.eventDate.slice(0, 10)}`,
        guests: [...seg.guests],
      });
      continue;
    }
    if (seg.eventDate > existing.latestDate) {
      existing.latestDate = seg.eventDate;
      existing.slug = `${slugify(seg.eventName)}-${seg.eventDate.slice(0, 10)}`;
    }
    existing.guests.push(...seg.guests);
  }

  for (const e of byName.values()) {
    const override = REAL_DATE_OVERRIDES[e.eventName.toLowerCase()];
    if (override) {
      e.latestDate = new Date(override).toISOString();
      e.slug = `${slugify(e.eventName)}-${e.latestDate.slice(0, 10)}`;
    }
  }

  return Array.from(byName.values());
}

async function fetchSheetRows(): Promise<string[][]> {
  const keyPath = process.env.GOOGLE_DRIVE_CREDENTIALS ?? ".secrets/progsu-agent-drive.json";
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: SHEET_TAB,
  });
  return (res.data.values ?? []) as string[][];
}

async function main() {
  console.log(`Fetching "${SHEET_TAB}"...`);
  const rows = await fetchSheetRows();
  console.log(`  ${rows.length} raw rows`);

  const { segments, skippedNoEmail, unparsedTitles } = segmentRows(rows);
  if (unparsedTitles.length > 0) {
    console.warn(`  ! ${unparsedTitles.length} title row(s) didn't match the expected format, segment skipped:`);
    for (const t of unparsedTitles) console.warn(`      "${t}"`);
  }

  const merged = mergeByEventName(segments);
  const totalGuestRows = merged.reduce((n, e) => n + e.guests.length, 0);
  const uniqueEmails = new Set(merged.flatMap((e) => e.guests.map((g) => g.email)));

  console.log(`\nImport plan (${DRY_RUN ? "DRY RUN" : "EXECUTE"})`);
  console.log(`  Guest-list snapshots (title rows):     ${segments.length}`);
  console.log(`  Merged into unique events:              ${merged.length}`);
  console.log(`  Guest rows with an email:                ${totalGuestRows}`);
  console.log(`  Guest rows skipped (no email):           ${skippedNoEmail}`);
  console.log(`  Unique attendee emails across all events: ${uniqueEmails.size}\n`);

  if (DRY_RUN) {
    for (const e of merged.slice(0, 20)) {
      const approved = e.guests.filter((g) => g.approvalStatus?.toLowerCase() === "approved").length;
      const checkedIn = e.guests.filter((g) => g.checkedInAt !== null).length;
      console.log(
        `  ${e.eventName}  [${e.slug}]  date=${e.latestDate.slice(0, 10)}  guests=${e.guests.length}  approved=${approved}  checked_in=${checkedIn}`
      );
    }
    if (merged.length > 20) console.log(`  ... (${merged.length} total events)`);
    console.log("\n[dry-run] no writes performed.");
    return;
  }

  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log(`Connected to: ${env.NEXT_PUBLIC_SUPABASE_URL}`);

  const { data: domainRows, error: domainErr } = await admin
    .from("school_domains")
    .select("domain")
    .eq("is_active", true);
  if (domainErr) throw new Error(`school_domains lookup failed: ${domainErr.message}`);
  const campusDomains = new Set((domainRows ?? []).map((d) => (d.domain as string).toLowerCase()));

  function emailDomain(email: string): string {
    return email.slice(email.indexOf("@") + 1).toLowerCase();
  }

  // email (lowercase) -> legacy_members.id, populated lazily as we go so
  // the same person across many events only ever hits legacy_members once.
  const legacyIdByEmail = new Map<string, string>();

  async function getOrCreateLegacyMember(g: GuestRow, sourceDetail: string): Promise<string> {
    const cached = legacyIdByEmail.get(g.email);
    if (cached) return cached;

    const isCampus = campusDomains.has(emailDomain(g.email));
    const emailCol = isCampus ? "campus_email" : "personal_email";

    const { data: existing } = await admin
      .from("legacy_members")
      .select("id")
      .eq(emailCol, g.email)
      .maybeSingle();
    if (existing) {
      legacyIdByEmail.set(g.email, existing.id);
      return existing.id;
    }

    const fullName = g.name ?? ([g.firstName, g.lastName].filter(Boolean).join(" ") || null);
    const { data: inserted, error: insertErr } = await admin
      .from("legacy_members")
      .insert({
        full_name: fullName,
        first_name: g.firstName,
        last_name: g.lastName,
        personal_email: isCampus ? null : g.email,
        campus_email: isCampus ? g.email : null,
        phone_number: g.phone,
        source: "luma_export",
        source_detail: sourceDetail,
      })
      .select("id")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        // Race: someone else (or an earlier row in this same run under a
        // slightly different casing) inserted it first. Re-select.
        const { data: retryFound, error: retryErr } = await admin
          .from("legacy_members")
          .select("id")
          .eq(emailCol, g.email)
          .maybeSingle();
        if (retryErr || !retryFound) {
          throw new Error(`legacy_members lookup after conflict failed for ${g.email}: ${retryErr?.message}`);
        }
        legacyIdByEmail.set(g.email, retryFound.id);
        return retryFound.id;
      }
      throw new Error(`legacy_members insert failed for ${g.email}: ${insertErr.message}`);
    }

    legacyIdByEmail.set(g.email, inserted.id);
    return inserted.id;
  }

  let eventsCreated = 0;
  let eventsMatched = 0;
  let legacyCreated = 0;
  let legacyMatched = 0;
  let attendanceUpserted = 0;

  for (const e of merged) {
    const { data: existingEvent } = await admin
      .from("events")
      .select("id")
      .eq("slug", e.slug)
      .maybeSingle();

    let eventId: string;
    if (existingEvent) {
      eventId = existingEvent.id;
      eventsMatched++;
    } else {
      const startsAt = e.latestDate;
      const endsAt = new Date(new Date(startsAt).getTime() + 4 * 60 * 60 * 1000).toISOString();
      const { data: insertedEvent, error: eventErr } = await admin
        .from("events")
        .insert({
          slug: e.slug,
          title: e.eventName,
          status: "archived",
          visibility: "members",
          starts_at: startsAt,
          ends_at: endsAt,
          import_source: "legacy_luma_import",
        })
        .select("id")
        .single();
      if (eventErr) {
        console.warn(`  ! failed to create event "${e.eventName}": ${eventErr.message}`);
        continue;
      }
      eventId = insertedEvent.id;
      eventsCreated++;
    }

    for (const g of e.guests) {
      const beforeCreate = legacyIdByEmail.has(g.email);
      const legacyMemberId = await getOrCreateLegacyMember(g, e.eventName);
      if (beforeCreate) legacyMatched++;
      else legacyCreated++;

      const { error: attErr } = await admin
        .from("historical_event_attendances")
        .upsert(
          {
            event_id: eventId,
            legacy_member_id: legacyMemberId,
            registered_at: g.createdAt,
            approval_status: g.approvalStatus,
            checked_in_at: g.checkedInAt,
            ticket_name: g.ticketName,
            source_detail: e.eventName,
          },
          { onConflict: "event_id,legacy_member_id" }
        );
      if (attErr) {
        console.warn(`  ! attendance upsert failed for ${g.email} @ "${e.eventName}": ${attErr.message}`);
        continue;
      }
      attendanceUpserted++;
    }
  }

  console.log(`\nEvents created: ${eventsCreated}, matched existing: ${eventsMatched}`);
  console.log(`Legacy members created: ${legacyCreated}, matched existing: ${legacyMatched}`);
  console.log(`Attendance rows upserted: ${attendanceUpserted}`);
}

main().catch((e) => {
  console.error("import-historical-events:", e);
  process.exit(1);
});
