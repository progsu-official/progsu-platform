#!/usr/bin/env tsx
// Smoke: per-event staff assignments + mobile_staff_scan + points ledger.
//   - assignment scoping (staff for A cannot scan B), revoked/expired staff denied
//   - scan results: invalid_code, wrong_event, not_rsvpd, outside_window, revoked pass
//   - two concurrent scans -> one attendance + one award
//   - remove/re-check-in cannot farm (net award stays at one)
//   - self_qr awards nothing; admin correct_attendance 'set' awards nothing
//   - direct client writes to point_ledger / staff table denied
//   - anon/authenticated cannot execute service-only / internal functions

import {
  admin,
  anon,
  assertNoExecute,
  check,
  cleanup,
  failureCount,
  makeEvent,
  makeUser,
  rsvpGoing,
} from "./_smoke-mobile-helpers";

async function ledgerFor(userId: string, eventId: string) {
  const { data } = await admin
    .from("point_ledger")
    .select("amount, kind, entitlement_key, actor")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .order("created_at");
  return data ?? [];
}

async function main() {
  const officer = await makeUser("officer", { admin: true, onboarded: true });
  const staff = await makeUser("staff", { onboarded: true });
  const other = await makeUser("otherstaff", { onboarded: true });
  const member = await makeUser("member", { onboarded: true });
  const member2 = await makeUser("member2", { onboarded: true });

  const evA = await makeEvent({ startsInMinutes: 30 });
  const evB = await makeEvent({ startsInMinutes: 30 });
  const evFar = await makeEvent({ startsInMinutes: 60 * 24 * 3 });

  // Points rule set by the officer through the helper.
  const { error: ruleErr } = await officer.db.rpc("admin_set_event_points", { p_event_id: evA.id, p_points: 10 });
  check(!ruleErr, "admin_set_event_points works for admin", ruleErr);
  const { error: ruleDenied } = await staff.db.rpc("admin_set_event_points", { p_event_id: evA.id, p_points: 99 });
  check(ruleDenied && /admin only/.test(ruleDenied.message), "non-admin cannot set points", ruleDenied);

  // Grants.
  const { error: g1 } = await officer.db.rpc("admin_grant_event_staff", { p_event_id: evA.id, p_user_id: staff.id });
  check(!g1, "grant staff on A", g1);
  await officer.db.rpc("admin_grant_event_staff", { p_event_id: evFar.id, p_user_id: staff.id });
  const { error: gDenied } = await staff.db.rpc("admin_grant_event_staff", { p_event_id: evB.id, p_user_id: staff.id });
  check(gDenied, "non-admin cannot grant staff", gDenied);

  // Assignment scoping.
  const { data: profile } = await admin.from("profiles").select("checkin_code").eq("id", member.id).single();
  const code = String(profile!.checkin_code);
  const { error: scopeErr } = await staff.db.rpc("mobile_staff_scan", { p_event_id: evB.id, p_code: code });
  check(scopeErr && /not event staff/.test(scopeErr.message), "staff for A cannot scan B", scopeErr);
  const { error: otherErr } = await other.db.rpc("mobile_staff_scan", { p_event_id: evA.id, p_code: code });
  check(otherErr && /not event staff/.test(otherErr.message), "unassigned member cannot scan", otherErr);
  const { error: rosterErr } = await other.db.rpc("mobile_staff_roster", { p_event_id: evA.id, p_query: null });
  check(rosterErr && /not event staff/.test(rosterErr.message), "unassigned member cannot read roster", rosterErr);

  const scan = async (eventId: string, c: string, who = staff) => {
    const { data, error } = await who.db.rpc("mobile_staff_scan", { p_event_id: eventId, p_code: c });
    if (error) throw new Error(`scan: ${error.message}`);
    return (data as Array<{ result: string; points_awarded: number; attendee_name: string | null }>)[0];
  };

  check((await scan(evA.id, "garbage")).result === "invalid_code", "garbage -> invalid_code");
  check((await scan(evA.id, crypto.randomUUID())).result === "invalid_code", "unknown uuid -> invalid_code");
  check((await scan(evA.id, code)).result === "not_rsvpd", "no RSVP -> not_rsvpd");

  // RSVP token for event B scanned at A -> wrong_event.
  await rsvpGoing(member, evB.id);
  const { data: rB } = await admin.from("event_rsvps").select("checkin_token").eq("event_id", evB.id).eq("user_id", member.id).single();
  if (rB?.checkin_token) {
    check((await scan(evA.id, String(rB.checkin_token))).result === "wrong_event", "RSVP token for B at A -> wrong_event");
  } else {
    check(false, "RSVP checkin_token minted on going", rB);
  }

  // Outside window: far-future event.
  await rsvpGoing(member, evFar.id);
  check((await scan(evFar.id, code)).result === "outside_window", "3 days out -> outside_window");

  // Pass tokens: issue twice, first is revoked.
  await rsvpGoing(member, evA.id);
  const { data: p1, error: p1e } = await member.db.rpc("issue_event_pass", { p_event_id: evA.id });
  const { data: p2 } = await member.db.rpc("issue_event_pass", { p_event_id: evA.id });
  check(!p1e && p1?.[0]?.token?.startsWith("pp1."), "issue_event_pass returns opaque token", p1e);
  check(p1?.[0]?.serial === p2?.[0]?.serial, "pass serial stable across re-issue");
  check((await scan(evA.id, p1![0].token)).result === "revoked", "old pass token -> revoked");
  const { data: passRows } = await member.db.from("event_pass_tokens").select("id");
  check(!passRows || passRows.length === 0, "client cannot read pass token hashes");

  // Concurrent scans: one attendance, one award.
  const [s1, s2] = await Promise.all([scan(evA.id, p2![0].token), scan(evA.id, code)]);
  const results = [s1.result, s2.result].sort();
  check(
    JSON.stringify(results) === JSON.stringify(["already_checked_in", "checked_in"]),
    "two concurrent scans -> one checked_in + one already_checked_in",
    results
  );
  check(s1.points_awarded + s2.points_awarded === 10, "exactly one award of 10", [s1, s2]);
  const { data: att } = await admin.from("event_attendances").select("checked_in_by, method").eq("event_id", evA.id).eq("user_id", member.id);
  check(att?.length === 1 && att[0].checked_in_by === staff.id && att[0].method === "qr_token", "attendance has real actor", att);
  check((await scan(evA.id, code)).result === "already_checked_in", "re-scan idempotent");

  // Remove + re-check-in: no farming.
  const { error: rmErr } = await officer.db.rpc("correct_attendance", {
    p_event_id: evA.id,
    p_user_id: member.id,
    p_action: "remove",
    p_note: null,
  });
  check(!rmErr, "officer removes attendance", rmErr);
  let ledger = await ledgerFor(member.id, evA.id);
  check(ledger.reduce((s, r) => s + r.amount, 0) === 0, "removal reverses award (net 0)", ledger);
  const again = await scan(evA.id, code);
  check(again.result === "checked_in" && again.points_awarded === 10, "re-check-in after reversal re-awards once", again);
  check((await scan(evA.id, code)).result === "already_checked_in", "third scan no-op");
  ledger = await ledgerFor(member.id, evA.id);
  const net = ledger.reduce((s, r) => s + r.amount, 0);
  check(net === 10, "net award capped at one award", ledger);
  check(new Set(ledger.map((r) => r.entitlement_key)).size === ledger.length, "entitlement keys unique");

  // Concurrent remove+recheck cycles still never exceed one award net.
  for (let i = 0; i < 3; i += 1) {
    await officer.db.rpc("correct_attendance", { p_event_id: evA.id, p_user_id: member.id, p_action: "remove", p_note: null });
    await Promise.all([scan(evA.id, code), scan(evA.id, code)]);
  }
  ledger = await ledgerFor(member.id, evA.id);
  check(ledger.reduce((s, r) => s + r.amount, 0) === 10, "repeated remove/rescan cycles net 10", ledger);

  // self_qr awards nothing.
  await rsvpGoing(member2, evA.id);
  const { data: selfRes, error: selfErr } = await member2.db.rpc("self_check_in_by_event", { p_event_id: evA.id });
  check(!selfErr && selfRes?.[0], "self_check_in_by_event works", selfErr);
  check((await ledgerFor(member2.id, evA.id)).length === 0, "self_qr writes no ledger row");
  // ...and a later staff scan sees already_checked_in, no award.
  const { data: m2 } = await admin.from("profiles").select("checkin_code").eq("id", member2.id).single();
  const after = await scan(evA.id, String(m2!.checkin_code));
  check(after.result === "already_checked_in" && after.points_awarded === 0, "staff scan after self_qr awards nothing", after);

  // Admin backfill awards nothing.
  const member3 = await makeUser("member3", { onboarded: true });
  await officer.db.rpc("correct_attendance", { p_event_id: evA.id, p_user_id: member3.id, p_action: "set", p_note: "backfill" });
  check((await ledgerFor(member3.id, evA.id)).length === 0, "admin correct_attendance 'set' awards nothing");

  // Manual check-in requires reason + going RSVP, awards once.
  const member4 = await makeUser("member4", { onboarded: true });
  const { error: noReason } = await staff.db.rpc("mobile_staff_manual_checkin", { p_event_id: evA.id, p_user_id: member4.id, p_reason: "" });
  check(noReason && /reason required/.test(noReason.message), "manual check-in requires reason", noReason);
  const { data: manNo } = await staff.db.rpc("mobile_staff_manual_checkin", { p_event_id: evA.id, p_user_id: member4.id, p_reason: "phone died" });
  check(manNo?.[0]?.result === "not_rsvpd", "manual without RSVP -> not_rsvpd", manNo);
  await rsvpGoing(member4, evA.id);
  const { data: man } = await staff.db.rpc("mobile_staff_manual_checkin", { p_event_id: evA.id, p_user_id: member4.id, p_reason: "phone died" });
  check(man?.[0]?.result === "checked_in" && man[0].points_awarded === 10, "manual check-in awards", man);

  // Roster minimal fields.
  const { data: roster, error: rErr } = await staff.db.rpc("mobile_staff_roster", { p_event_id: evA.id, p_query: "member" });
  check(!rErr && Array.isArray(roster) && roster.length >= 2, "roster returns rows", rErr ?? roster);
  check(
    roster && roster.every((r: Record<string, unknown>) => Object.keys(r).sort().join(",") === "checked_in,checked_in_at,display_name,rsvp_status,user_id"),
    "roster exposes only minimal fields",
    roster?.[0]
  );

  // Officer adjustment.
  const { error: adjNoReason } = await officer.db.rpc("admin_adjust_points", { p_user_id: member.id, p_amount: 5, p_reason: "", p_event_id: null });
  check(adjNoReason, "adjustment requires reason");
  const { error: adjErr } = await officer.db.rpc("admin_adjust_points", { p_user_id: member.id, p_amount: 15, p_reason: "Fermi winner", p_event_id: null });
  check(!adjErr, "officer adjustment", adjErr);
  const { data: bal } = await member.db.rpc("points_balance", { p_user_id: null });
  check(bal === 25, "balance = sum of ledger (10 + 15)", bal);
  const { error: balOther } = await member.db.rpc("points_balance", { p_user_id: member2.id });
  check(balOther, "member cannot read another member's balance");

  // Direct client writes denied.
  const { error: insErr } = await member.db.from("point_ledger").insert({
    user_id: member.id, entitlement_key: `x-${Date.now()}`, amount: 1000, kind: "adjustment", source: "officer_adjustment", reason: "hack",
  });
  check(insErr, "client cannot insert ledger rows", insErr);
  const { data: upd } = await member.db.from("point_ledger").update({ amount: 9999 }).eq("user_id", member.id).select();
  check(!upd || upd.length === 0, "client cannot update ledger rows");
  const { data: del } = await officer.db.from("point_ledger").delete().eq("user_id", member.id).select();
  check(!del || del.length === 0, "even admin JWT cannot delete ledger rows");
  const { error: svcUpd } = await admin.from("point_ledger").update({ amount: 1 }).eq("user_id", member.id);
  check(svcUpd, "service role has no ledger UPDATE grant", svcUpd);
  const { error: staffIns } = await member.db.from("event_staff_assignments").insert({ event_id: evA.id, user_id: member.id });
  check(staffIns, "client cannot self-assign staff", staffIns);
  const { data: others } = await member.db.from("point_ledger").select("id").eq("user_id", member2.id);
  check(!others || others.length === 0, "member cannot read another member's ledger");

  // Revoked + expired staff denied.
  await officer.db.rpc("admin_revoke_event_staff", { p_event_id: evA.id, p_user_id: staff.id });
  const { error: revErr } = await staff.db.rpc("mobile_staff_scan", { p_event_id: evA.id, p_code: code });
  check(revErr && /not event staff/.test(revErr.message), "revoked staff denied", revErr);
  await officer.db.rpc("admin_grant_event_staff", { p_event_id: evA.id, p_user_id: other.id, p_expires_at: new Date(Date.now() + 60_000).toISOString() });
  await admin.from("event_staff_assignments").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("user_id", other.id).eq("event_id", evA.id);
  const { error: expErr } = await other.db.rpc("mobile_staff_scan", { p_event_id: evA.id, p_code: code });
  check(expErr && /not event staff/.test(expErr.message), "expired staff denied", expErr);

  // Function lockdown (hard rule 10).
  const fakeId = crypto.randomUUID();
  for (const [client, who] of [[anon, "anon"], [member.db, "authenticated"]] as const) {
    await assertNoExecute(client, "_points_award_attendance", { p_event_id: fakeId, p_user_id: fakeId, p_actor: fakeId, p_source: "x" }, who);
    await assertNoExecute(client, "_points_lock", { p_event_id: fakeId, p_user_id: fakeId }, who);
    await assertNoExecute(client, "hacklanta_link_code_create", { p_user_id: fakeId, p_email: "a@b.co", p_application_id: null, p_code: "123456", p_ttl_minutes: 10 }, who);
    await assertNoExecute(client, "hacklanta_link_code_verify", { p_user_id: fakeId, p_code: "123456" }, who);
    await assertNoExecute(client, "push_outbox_claim", { p_limit: 1 }, who);
    await assertNoExecute(client, "push_outbox_finish", { p_id: fakeId, p_status: "sent", p_error: null }, who);
  }
  for (const fn of [
    ["mobile_staff_scan", { p_event_id: fakeId, p_code: "x" }],
    ["mobile_staff_manual_checkin", { p_event_id: fakeId, p_user_id: fakeId, p_reason: "xxxx" }],
    ["mobile_staff_roster", { p_event_id: fakeId, p_query: null }],
    ["issue_event_pass", { p_event_id: fakeId }],
    ["admin_set_event_points", { p_event_id: fakeId, p_points: 1 }],
    ["admin_adjust_points", { p_user_id: fakeId, p_amount: 1, p_reason: "xxx", p_event_id: null }],
    ["register_device_token", { p_token: "a".repeat(64), p_env: "sandbox" }],
  ] as const) {
    await assertNoExecute(anon, fn[0], fn[1], "anon");
  }
}

main()
  .catch((e) => {
    console.error("[smoke-mobile-staff-points] threw:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    const f = failureCount();
    if (f > 0) {
      console.error(`[smoke-mobile-staff-points] ${f} FAILED`);
      process.exitCode = 1;
    } else if (!process.exitCode) {
      console.log("[smoke-mobile-staff-points] ALL OK");
    }
  });
