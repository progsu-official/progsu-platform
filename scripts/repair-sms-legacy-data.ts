#!/usr/bin/env tsx
// Repairs the SMS-related legacy data that the original master-sheet import
// missed. That import ran against a Drive text extraction which silently
// truncated the source spreadsheet, so it saw roughly a third of the rows.
// This re-runs against the XLSX export and fixes four things:
//
//   1. sms_suppressions  — load the do-not-text list. Sourced from Twilio's
//      own inbound message log (authoritative), unioned with the sheet's
//      mirror. Runs FIRST and independently: everything else is optional,
//      this is the one that prevents texting someone who said STOP.
//   2. legacy_members.phone_e164 — a plain column (not generated, unlike
//      profiles.phone_e164), never backfilled. 1 of ~1.2k rows populated.
//   3. sms_consent_at / sms_consent_copy — the verbatim disclosure text and
//      the timestamp it was accepted. This is the carrier-audit evidence;
//      the import collapsed it into the sms_interest boolean and dropped it.
//   4. legacy_members rows for people the truncated import never saw.
//
// Plus school_domains rows for the campuses in the roster that aren't
// registered yet, so school attribution resolves.
//
// Usage:
//   pnpm tsx scripts/repair-sms-legacy-data.ts <roster.json> <stops.json> --dry-run
//   pnpm tsx scripts/repair-sms-legacy-data.ts <roster.json> <stops.json>

import { config } from "dotenv";
config({ path: ".env.local" });
import * as fs from "fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");
const [rosterPath, stopsPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!rosterPath || !stopsPath) {
  console.error("Usage: repair-sms-legacy-data.ts <roster.json> <stops.json> [--dry-run]");
  process.exit(1);
}

type Person = {
  phone_digits: string; phone_e164: string;
  full_name: string | null; first_name: string | null; last_name: string | null;
  campus_email: string | null; personal_email: string | null;
  sms_interest: boolean; sms_consent_at: string | null; sms_consent_copy: string | null;
  hacklanta: boolean; sources: string[];
};

// Mirrors public.normalize_phone_e164 exactly. Anything unparseable is NULL,
// which is the correct failure mode: a number we can't canonicalise must never
// match a suppression entry by accident.
function e164(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  return /^[2-9]\d{9}$/.test(t) ? "+1" + t : null;
}

// Campuses present in the roster but absent from school_domains. Without these
// 84 people resolve to "unknown school", which matters because the non-GSU
// segment is the entire cross-campus reach for Hacklanta.
const NEW_SCHOOL_DOMAINS = [
  { domain: "students.kennesaw.edu", school_name: "Kennesaw State University", school_slug: "ksu-students" },
  { domain: "uga.edu", school_name: "University of Georgia", school_slug: "uga" },
  { domain: "students.cau.edu", school_name: "Clark Atlanta University", school_slug: "cau" },
  { domain: "morehouse.edu", school_name: "Morehouse College", school_slug: "morehouse" },
  { domain: "ung.edu", school_name: "University of North Georgia", school_slug: "ung" },
  { domain: "ggc.edu", school_name: "Georgia Gwinnett College", school_slug: "ggc" },
  { domain: "student.atlantatech.edu", school_name: "Atlanta Technical College", school_slug: "atlanta-tech" },
  { domain: "students.campbellsville.edu", school_name: "Campbellsville University", school_slug: "campbellsville" },
  { domain: "live.mercer.edu", school_name: "Mercer University", school_slug: "mercer" },
  { domain: "crimson.ua.edu", school_name: "University of Alabama", school_slug: "alabama" },
];

async function main() {
  const roster: Person[] = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  const stops: string[] = JSON.parse(fs.readFileSync(stopsPath, "utf8"));
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log(`\n=== SMS legacy data repair (${DRY ? "DRY RUN" : "EXECUTE"}) ===\n`);

  // ---- load current state -------------------------------------------------
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from("legacy_members")
      .select("id,full_name,personal_email,campus_email,phone_number,phone_e164,sms_interest,sms_consent_at")
      .range(from, from + 999);
    if (error) throw new Error(`legacy_members read: ${error.message}`);
    rows.push(...data!);
    if (data!.length < 1000) break;
  }
  const emailIdx = new Map<string, any>();
  const phoneIdx = new Map<string, any>();
  for (const r of rows) {
    if (r.personal_email) emailIdx.set(r.personal_email.toLowerCase(), r);
    if (r.campus_email) emailIdx.set(r.campus_email.toLowerCase(), r);
    // Phone is the second matching key on purpose. This script normalises
    // campus-email domain typos that the original import didn't know about
    // ("gsu.student.edu" -> "student.gsu.edu"), so a person already in the DB
    // under the typo'd address would not match on email and would be inserted
    // a second time. Matching on phone as well catches exactly that case.
    const pe = r.phone_e164 ?? e164(r.phone_number);
    if (pe && !phoneIdx.has(pe)) phoneIdx.set(pe, r);
  }
  const { count: supExisting } = await s.from("sms_suppressions").select("*", { count: "exact", head: true });

  // ---- 1. suppressions ----------------------------------------------------
  const supTargets = stops.map((p) => e164(p)).filter((p): p is string => !!p);
  console.log(`1. sms_suppressions`);
  console.log(`     existing rows:        ${supExisting}`);
  console.log(`     to load:              ${supTargets.length}`);

  // ---- 2. phone_e164 backfill --------------------------------------------
  const e164Targets = rows
    .filter((r) => r.phone_number && !r.phone_e164 && e164(r.phone_number))
    .map((r) => ({ id: r.id, phone_e164: e164(r.phone_number)! }));
  const unparseable = rows.filter((r) => r.phone_number && !r.phone_e164 && !e164(r.phone_number)).length;
  console.log(`\n2. legacy_members.phone_e164`);
  console.log(`     rows to backfill:     ${e164Targets.length}`);
  console.log(`     unparseable (skip):   ${unparseable}`);

  // ---- 3. consent evidence ------------------------------------------------
  // Only rows where the person actually saw the verbatim disclosure. The
  // bare "Yes" cells are NOT promoted: a spreadsheet cell reading "Yes" is
  // not evidence of what was shown to them, and inventing consent records is
  // worse than having none.
  const consentTargets: { id: string; at: string; copy: string }[] = [];
  for (const p of roster) {
    if (!p.sms_consent_at || !p.sms_consent_copy) continue;
    const hit = (p.campus_email && emailIdx.get(p.campus_email))
      || (p.personal_email && emailIdx.get(p.personal_email))
      || phoneIdx.get(p.phone_e164);
    if (hit && !hit.sms_consent_at) consentTargets.push({ id: hit.id, at: p.sms_consent_at, copy: p.sms_consent_copy });
  }
  const verbatimTotal = roster.filter((p) => p.sms_consent_at).length;
  console.log(`\n3. sms_consent_at / sms_consent_copy`);
  console.log(`     roster w/ verbatim:   ${verbatimTotal}`);
  console.log(`     matched to a DB row:  ${consentTargets.length}`);
  console.log(`     (bare "Yes" rows deliberately NOT promoted)`);

  // ---- 4. missing people --------------------------------------------------
  const missing = roster.filter((p) => {
    const c = p.campus_email && emailIdx.has(p.campus_email);
    const e = p.personal_email && emailIdx.has(p.personal_email);
    const ph = phoneIdx.has(p.phone_e164);
    return !c && !e && !ph;
  });
  const matchedOnPhoneOnly = roster.filter((p) => {
    const c = p.campus_email && emailIdx.has(p.campus_email);
    const e = p.personal_email && emailIdx.has(p.personal_email);
    return !c && !e && phoneIdx.has(p.phone_e164);
  }).length;
  console.log(`\n4. legacy_members inserts (missed by truncated import)`);
  console.log(`     people to insert:     ${missing.length}`);
  console.log(`     matched on phone only:${matchedOnPhoneOnly}  (email typo'd in DB — NOT re-inserted)`);
  console.log(`     of those, Hacklanta:  ${missing.filter((p) => p.hacklanta).length}`);
  console.log(`     of those, opted in:   ${missing.filter((p) => p.sms_interest).length}`);

  // ---- 5. school domains --------------------------------------------------
  const { data: sd } = await s.from("school_domains").select("domain");
  const have = new Set((sd ?? []).map((r: any) => r.domain));
  const newDomains = NEW_SCHOOL_DOMAINS.filter((d) => !have.has(d.domain));
  console.log(`\n5. school_domains`);
  console.log(`     rows to add:          ${newDomains.length}`);

  if (DRY) {
    console.log(`\n--- sample inserts ---`);
    for (const p of missing.slice(0, 8)) {
      console.log(`  ${p.full_name ?? "(no name)"}  ${p.campus_email ?? p.personal_email}  ${p.hacklanta ? "[hacklanta]" : ""}`);
    }
    console.log(`\n[dry-run] no writes performed.\n`);
    return;
  }

  // ---- execute ------------------------------------------------------------
  let ok = 0, fail = 0;
  for (const phone of supTargets) {
    const { error } = await s.rpc("suppress_sms_number", { p_phone: phone, p_reason: "stop_keyword", p_note: "backfill: twilio inbound log + apps script mirror" });
    if (error) { fail++; console.warn(`  ! suppress ${phone}: ${error.message}`); } else ok++;
  }
  console.log(`\n1. suppressed ${ok}, failed ${fail}`);

  ok = 0; fail = 0;
  for (const t of e164Targets) {
    const { error } = await s.from("legacy_members").update({ phone_e164: t.phone_e164 }).eq("id", t.id);
    if (error) { fail++; } else ok++;
  }
  console.log(`2. phone_e164 backfilled ${ok}, failed ${fail}`);

  ok = 0; fail = 0;
  for (const t of consentTargets) {
    const { error } = await s.from("legacy_members").update({ sms_consent_at: t.at, sms_consent_copy: t.copy }).eq("id", t.id);
    if (error) { fail++; } else ok++;
  }
  console.log(`3. consent evidence restored ${ok}, failed ${fail}`);

  ok = 0; fail = 0; let dup = 0;
  for (const p of missing) {
    const { error } = await s.from("legacy_members").insert({
      full_name: p.full_name, first_name: p.first_name, last_name: p.last_name,
      personal_email: p.personal_email, campus_email: p.campus_email,
      phone_number: p.phone_e164, phone_e164: p.phone_e164,
      sms_interest: p.sms_interest, sms_consent_at: p.sms_consent_at, sms_consent_copy: p.sms_consent_copy,
      source: "master_sheet_2025_2026", source_detail: p.hacklanta ? "hacklanta-f26" : "xlsx-repair",
    });
    if (error) { if (error.code === "23505") dup++; else { fail++; console.warn(`  ! ${p.full_name}: ${error.message}`); } } else ok++;
  }
  console.log(`4. inserted ${ok}, duplicate ${dup}, failed ${fail}`);

  if (newDomains.length) {
    const { error } = await s.from("school_domains").insert(newDomains);
    console.log(`5. school_domains: ${error ? "FAILED " + error.message : `added ${newDomains.length}`}`);
  }
  console.log();
}

main().catch((e) => { console.error("repair-sms-legacy-data:", e.message); process.exit(1); });
