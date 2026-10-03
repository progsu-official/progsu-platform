#!/usr/bin/env tsx
// Smoke: POST /api/mobile/v1/me/delete against a running app
// (MOBILE_SMOKE_BASE, default http://localhost:3000).
//   - requires {confirm:"DELETE"}
//   - removes storage objects (resumes/avatars/banners under {uid}/),
//     device tokens, Apple token row, and the auth user (profile cascades:
//     consents, RSVPs, attendance, ledger, links, bookmarks)
//   - records a completed account_deletion_jobs row that survives the user
//   - a repeat call with the old token is 401 (user gone), and other users
//     are untouched

import { admin, check, cleanup, failureCount, makeEvent, makeUser, rsvpGoing } from "./_smoke-mobile-helpers";

const BASE = (process.env.MOBILE_SMOKE_BASE ?? "http://localhost:3000") + "/api/mobile/v1";

async function del(token: string, body: unknown) {
  const res = await fetch(`${BASE}/me/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function main() {
  const victim = await makeUser("deleteme", { onboarded: true });
  const bystander = await makeUser("bystander", { onboarded: true });
  const officer = await makeUser("officer", { admin: true, onboarded: true });
  const ev = await makeEvent({ startsInMinutes: 20 });
  await rsvpGoing(victim, ev.id);
  await officer.db.rpc("admin_set_event_points", { p_event_id: ev.id, p_points: 3 });
  await officer.db.rpc("correct_attendance", { p_event_id: ev.id, p_user_id: victim.id, p_action: "set", p_note: null });
  await officer.db.rpc("admin_adjust_points", { p_user_id: victim.id, p_amount: 4, p_reason: "smoke prize", p_event_id: null });

  const pdf = new Blob([Buffer.from("%PDF-1.4 smoke")], { type: "application/pdf" });
  const png = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  for (const [bucket, name, blob] of [
    ["resumes", "smoke.pdf", pdf],
    ["avatars", "smoke.png", png],
    ["banners", "smoke.png", png],
  ] as const) {
    const { error } = await admin.storage.from(bucket).upload(`${victim.id}/${name}`, blob, { upsert: true });
    check(!error, `seed ${bucket} object`, error);
  }
  const { error: bErr } = await admin.storage.from("resumes").upload(`${bystander.id}/keep.pdf`, pdf, { upsert: true });
  check(!bErr, "seed bystander resume", bErr);
  await victim.db.rpc("register_device_token", { p_token: "cd".repeat(32), p_env: "production" });
  await admin.from("apple_provider_tokens").insert({ user_id: victim.id, client_id: "smoke.client", refresh_token_ciphertext: "v1.x.y.z" });

  const bad = await del(victim.token, { confirm: "delete" });
  check(bad.status === 400, "lowercase confirm rejected", bad);

  const res = await del(victim.token, { confirm: "DELETE" });
  check(res.status === 200 && (res.body.data as { status?: string })?.status === "completed", "delete completes", res);
  if (process.argv.includes("--write-fixtures") && res.status === 200) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("ios/Progsu/ProgsuTests/Fixtures", { recursive: true });
    writeFileSync("ios/Progsu/ProgsuTests/Fixtures/me_delete.json", JSON.stringify(res.body, null, 2) + "\n");
  }

  const { data: authUser } = await admin.auth.admin.getUserById(victim.id);
  check(!authUser?.user, "auth user gone");
  const { data: prof } = await admin.from("profiles").select("id").eq("id", victim.id).maybeSingle();
  check(!prof, "profile gone");
  for (const t of ["consents", "event_rsvps", "event_attendances", "point_ledger", "device_tokens", "apple_provider_tokens"]) {
    const { count } = await admin.from(t).select("*", { count: "exact", head: true }).eq("user_id", victim.id);
    check(count === 0, `${t} rows gone`, count);
  }
  for (const b of ["resumes", "avatars", "banners"]) {
    const { data } = await admin.storage.from(b).list(victim.id);
    check((data ?? []).length === 0, `${b} objects gone`, data);
  }
  const { data: keep } = await admin.storage.from("resumes").list(bystander.id);
  check((keep ?? []).length === 1, "bystander's resume untouched");
  await admin.storage.from("resumes").remove([`${bystander.id}/keep.pdf`]);

  const { data: job } = await admin.from("account_deletion_jobs").select("status, steps, completed_at").eq("user_id", victim.id).single();
  check(job?.status === "completed" && job.completed_at, "deletion job recorded as completed", job);

  const again = await del(victim.token, { confirm: "DELETE" });
  check(again.status === 401, "repeat call with old token -> 401", again);

  const { data: still } = await admin.auth.admin.getUserById(bystander.id);
  check(Boolean(still?.user), "bystander still exists");
  await admin.from("account_deletion_jobs").delete().eq("user_id", victim.id);
}

main()
  .catch((e) => {
    console.error("[smoke-account-deletion] threw:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    if (failureCount() > 0) {
      console.error(`[smoke-account-deletion] ${failureCount()} FAILED`);
      process.exitCode = 1;
    } else if (!process.exitCode) console.log("[smoke-account-deletion] ALL OK");
  });
