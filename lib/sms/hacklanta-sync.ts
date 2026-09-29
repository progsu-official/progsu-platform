import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Copies accepted Hacklanta II applicants into hacklanta_sms_recipients
// (migrations 20260929120000, 20260929140000). Writes only that table; never
// creates a broadcast, so it cannot send anything.
//
// Shared by /admin/sms (runs on every page load, so the "emailed" count tracks
// the Hacklanta admin dashboard) and scripts/import-hacklanta-sms-recipients.ts.
// No "server-only" import so the script can load it; it needs service keys, so
// only call it from server code.

// The platform only texts US/Canada numbers (sms_deliveries check).
export function toUsE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9][0-9]{9}$/.test(national) ? `+1${national}` : null;
}

export type HacklantaSyncResult = {
  accepted: number;
  recipients: number;
  emailed: number;
  skippedInvalid: number;
  // Emailed applicants we can't text: no usable US number on the application.
  emailedNoNumber: number;
  pruned: number;
};

type Row = { first_name: string; phone: string; acceptance_email_sent_at: string | null };

export function hacklantaClient(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, { auth: { persistSession: false } });
}

async function readAccepted(hack: SupabaseClient): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await hack
      .from("applications")
      .select("first_name, phone, acceptance_email_sent_at")
      .eq("review_status", "accepted")
      .order("submitted_at")
      .range(from, from + 999);
    if (error) throw new Error(`read applications: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// One row per number. Two applications on one number: the earliest email
// send wins, so the number counts as emailed once either person was emailed.
export function toRecipients(rows: Row[]) {
  const byPhone = new Map<string, { first_name: string; email_sent_at: string | null }>();
  let skippedInvalid = 0;
  let emailedNoNumber = 0;
  for (const r of rows) {
    const phone = toUsE164(r.phone);
    if (!phone) {
      skippedInvalid += 1;
      if (r.acceptance_email_sent_at) emailedNoNumber += 1;
      continue;
    }
    const prev = byPhone.get(phone);
    const sent = r.acceptance_email_sent_at;
    if (!prev) byPhone.set(phone, { first_name: r.first_name, email_sent_at: sent });
    else if (sent && (!prev.email_sent_at || sent < prev.email_sent_at)) prev.email_sent_at = sent;
  }
  return { byPhone, skippedInvalid, emailedNoNumber };
}

export async function syncHacklantaRecipients(
  hack: SupabaseClient,
  platform: SupabaseClient,
  { apply }: { apply: boolean }
): Promise<HacklantaSyncResult> {
  const rows = await readAccepted(hack);
  const { byPhone, skippedInvalid, emailedNoNumber } = toRecipients(rows);
  const result: HacklantaSyncResult = {
    accepted: rows.length,
    recipients: byPhone.size,
    emailed: [...byPhone.values()].filter((v) => v.email_sent_at).length,
    skippedInvalid,
    emailedNoNumber,
    pruned: 0,
  };
  if (!apply) return result;

  // A read that came back empty is far more likely an outage than everyone
  // being un-accepted; don't let it wipe the audience.
  if (byPhone.size === 0) throw new Error("Hacklanta returned no accepted applicants; not syncing");

  const payload = [...byPhone].map(([phone_e164, v]) => ({ phone_e164, ...v }));
  const { error: upErr } = await platform
    .from("hacklanta_sms_recipients")
    .upsert(payload, { onConflict: "phone_e164" });
  if (upErr) throw new Error(`upsert: ${upErr.message}`);

  const { data: existing, error: exErr } = await platform
    .from("hacklanta_sms_recipients")
    .select("phone_e164");
  if (exErr) throw new Error(`read back: ${exErr.message}`);
  const stale = (existing ?? []).map((e) => e.phone_e164 as string).filter((p) => !byPhone.has(p));
  if (stale.length) {
    const { error: delErr } = await platform
      .from("hacklanta_sms_recipients")
      .delete()
      .in("phone_e164", stale);
    if (delErr) throw new Error(`prune: ${delErr.message}`);
  }
  result.pruned = stale.length;
  return result;
}

// Self-check: pnpm tsx lib/sms/hacklanta-sync.ts
if (process.argv[1]?.endsWith("hacklanta-sync.ts")) {
  const assert = (ok: boolean, m: string) => {
    if (!ok) throw new Error(m);
  };
  assert(toUsE164("(404) 207-6509") === "+14042076509", "formats US");
  assert(toUsE164("+14042076509") === "+14042076509", "keeps +1");
  assert(toUsE164("+442071234567") === null, "drops non-US");
  const { byPhone, skippedInvalid } = toRecipients([
    { first_name: "a", phone: "+14042076509", acceptance_email_sent_at: null },
    { first_name: "b", phone: "4042076509", acceptance_email_sent_at: "2026-09-29T10:00:00Z" },
    { first_name: "c", phone: "+4420", acceptance_email_sent_at: "2026-09-29T11:00:00Z" },
  ]);
  const { emailedNoNumber } = toRecipients([
    { first_name: "c", phone: "+4420", acceptance_email_sent_at: "2026-09-29T11:00:00Z" },
  ]);
  assert(byPhone.size === 1 && skippedInvalid === 1, "dedupes and skips");
  assert(emailedNoNumber === 1, "counts emailed with no usable number");
  assert(byPhone.get("+14042076509")!.email_sent_at === "2026-09-29T10:00:00Z", "emailed if either was");
  console.log("hacklanta-sync self-check ok");
}
