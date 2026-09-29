#!/usr/bin/env tsx
// Copies accepted Hacklanta II applicants' phone numbers into
// hacklanta_sms_recipients (migration 20260929120000), the table behind the
// 'hacklanta_accepted' SMS audience. Sends nothing.
//
// Read side: the Hacklanta II database, applications.review_status = 'accepted'.
// Write side: this platform's database, and only with --apply. The default is a
// dry run that prints counts and never writes.
//
// --apply also removes rows for people who are no longer accepted, so a later
// reject/waitlist drops them from the audience before the next send.
//
// Usage:
//   HACKLANTA_SUPABASE_URL=... HACKLANTA_SUPABASE_SECRET_KEY=... \
//     pnpm tsx scripts/import-hacklanta-sms-recipients.ts            # dry run
//   ... pnpm tsx scripts/import-hacklanta-sms-recipients.ts --apply

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return v;
}

// The platform's rule is US/Canada numbers only (sms_deliveries check).
export function toUsE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9][0-9]{9}$/.test(national) ? `+1${national}` : null;
}

async function main() {
  const hack = createClient(need("HACKLANTA_SUPABASE_URL"), need("HACKLANTA_SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false },
  });

  const rows: { first_name: string; phone: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await hack
      .from("applications")
      .select("first_name, phone")
      .eq("review_status", "accepted")
      .order("submitted_at")
      .range(from, from + 999);
    if (error) throw new Error(`read applications: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const byPhone = new Map<string, string>();
  let nonUs = 0;
  for (const r of rows) {
    const e164 = toUsE164(r.phone);
    if (!e164) nonUs += 1;
    else if (!byPhone.has(e164)) byPhone.set(e164, r.first_name);
  }
  console.log(
    `accepted applicants: ${rows.length} | usable US numbers: ${byPhone.size} | ` +
      `non-US/invalid skipped: ${nonUs} | duplicate numbers: ${rows.length - nonUs - byPhone.size}`
  );

  const platform = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false } }
  );
  const { data: supp, error: suppErr } = await platform
    .from("sms_suppressions")
    .select("phone_e164")
    .in("phone_e164", [...byPhone.keys()]);
  if (suppErr) throw new Error(`read sms_suppressions: ${suppErr.message}`);
  console.log(`already on the do-not-text list (will never be texted): ${supp?.length ?? 0}`);

  if (!APPLY) {
    console.log("dry run: nothing written. Re-run with --apply to write.");
    return;
  }

  const payload = [...byPhone].map(([phone_e164, first_name]) => ({ phone_e164, first_name }));
  const { error: upErr } = await platform
    .from("hacklanta_sms_recipients")
    .upsert(payload, { onConflict: "phone_e164" });
  if (upErr) throw new Error(`upsert: ${upErr.message}`);

  const { data: existing, error: exErr } = await platform
    .from("hacklanta_sms_recipients")
    .select("phone_e164");
  if (exErr) throw new Error(`read back: ${exErr.message}`);
  const stale = (existing ?? []).map((e) => e.phone_e164).filter((p) => !byPhone.has(p));
  if (stale.length) {
    const { error: delErr } = await platform
      .from("hacklanta_sms_recipients")
      .delete()
      .in("phone_e164", stale);
    if (delErr) throw new Error(`prune: ${delErr.message}`);
  }
  console.log(`wrote ${payload.length} recipients, pruned ${stale.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
