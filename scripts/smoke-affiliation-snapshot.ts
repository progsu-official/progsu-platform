#!/usr/bin/env tsx
// Smoke: affiliation snapshot on event_attendances insert.
//   - category = self-reported affiliation; verified_gsu only from a verified
//     student.gsu.edu email (self-reporting gsu_student is not enough)
//   - snapshot is a point-in-time copy (later profile edits don't change it)
//   - corrections only via admin helper, with reason, audited
//   - no client writes; members read only their own rows
//   - removing attendance drops the snapshot; re-check-in takes a fresh one

import { admin, check, cleanup, failureCount, makeEvent, makeUser } from "./_smoke-mobile-helpers";

async function snap(eventId: string, userId: string) {
  const { data } = await admin
    .from("event_attendance_affiliations")
    .select("*")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

async function main() {
  const officer = await makeUser("officer", { admin: true, onboarded: true });
  const claimsGsu = await makeUser("claimsgsu", { onboarded: true, affiliation: "gsu_student" });
  const verified = await makeUser("verified", { onboarded: true, affiliation: "gsu_student", gsuVerified: true });
  const nonstudent = await makeUser("nonstudent", { onboarded: true, affiliation: "nonstudent" });
  await admin.from("profiles").update({ school: null, major: null, institution_name: "Acme Corp" }).eq("id", nonstudent.id);

  const ev = await makeEvent({ startsInMinutes: 10 });
  for (const u of [claimsGsu, verified, nonstudent]) {
    const { error } = await officer.db.rpc("correct_attendance", { p_event_id: ev.id, p_user_id: u.id, p_action: "set", p_note: null });
    if (error) throw new Error(error.message);
  }

  const a = await snap(ev.id, claimsGsu.id);
  check(a?.category === "gsu_student" && a?.verified_gsu === false, "self-reported GSU is not verified", a);
  const b = await snap(ev.id, verified.id);
  check(b?.category === "gsu_student" && b?.verified_gsu === true, "verified student.gsu.edu -> verified_gsu", b);
  const c = await snap(ev.id, nonstudent.id);
  check(c?.category === "nonstudent" && c?.institution === "Acme Corp", "nonstudent + institution captured", c);
  check(a?.source === "checkin_trigger", "source = checkin_trigger");

  // Point in time.
  await admin.from("profiles").update({ affiliation: "other_student" }).eq("id", claimsGsu.id);
  check((await snap(ev.id, claimsGsu.id))?.category === "gsu_student", "later profile edit doesn't rewrite snapshot");

  // Client writes denied / own-only reads.
  const { data: upd } = await claimsGsu.db
    .from("event_attendance_affiliations")
    .update({ verified_gsu: true })
    .eq("user_id", claimsGsu.id)
    .select();
  check(!upd || upd.length === 0, "member cannot edit own snapshot");
  const { error: ins } = await claimsGsu.db.from("event_attendance_affiliations").insert({
    event_id: ev.id, user_id: claimsGsu.id, category: "gsu_student", verified_gsu: true, source: "checkin_trigger",
  });
  check(ins, "member cannot insert snapshot");
  const { data: own } = await claimsGsu.db.from("event_attendance_affiliations").select("user_id");
  check(own?.length === 1 && own[0].user_id === claimsGsu.id, "member reads only own snapshot", own);

  // Corrections.
  const { error: nonAdmin } = await claimsGsu.db.rpc("admin_correct_attendance_affiliation", {
    p_event_id: ev.id, p_user_id: claimsGsu.id, p_category: "other_student", p_institution: "KSU", p_reason: "typo",
  });
  check(nonAdmin && /admin only/.test(nonAdmin.message), "non-admin cannot correct", nonAdmin);
  const { error: noReason } = await officer.db.rpc("admin_correct_attendance_affiliation", {
    p_event_id: ev.id, p_user_id: claimsGsu.id, p_category: "other_student", p_institution: "KSU", p_reason: " ",
  });
  check(noReason && /reason/.test(noReason.message), "correction requires reason", noReason);
  const { error: okErr } = await officer.db.rpc("admin_correct_attendance_affiliation", {
    p_event_id: ev.id, p_user_id: claimsGsu.id, p_category: "other_student", p_institution: "Kennesaw State", p_reason: "Member said KSU at the door",
  });
  check(!okErr, "admin correction works", okErr);
  const fixed = await snap(ev.id, claimsGsu.id);
  check(
    fixed?.category === "other_student" && fixed?.source === "officer_correction" && fixed?.corrected_by === officer.id,
    "correction recorded with actor",
    fixed
  );
  const { data: audit } = await admin
    .from("audit_log")
    .select("actor_user_id, metadata")
    .eq("action", "attendance_affiliation.correct")
    .eq("target_user_id", claimsGsu.id);
  check(audit?.length === 1 && audit[0].actor_user_id === officer.id, "correction audited with real actor", audit);

  // Remove -> snapshot gone; re-check-in -> fresh snapshot.
  await officer.db.rpc("correct_attendance", { p_event_id: ev.id, p_user_id: claimsGsu.id, p_action: "remove", p_note: null });
  check((await snap(ev.id, claimsGsu.id)) === null, "removing attendance drops snapshot");
  await officer.db.rpc("correct_attendance", { p_event_id: ev.id, p_user_id: claimsGsu.id, p_action: "set", p_note: null });
  const fresh = await snap(ev.id, claimsGsu.id);
  check(fresh?.category === "other_student" && fresh?.source === "checkin_trigger", "re-check-in takes a fresh snapshot", fresh);

  // Unknown affiliation is not fully onboarded.
  const unknown = await makeUser("unknown", { onboarded: true, affiliation: "unknown" });
  await admin.from("profiles").update({ affiliation: "unknown" }).eq("id", unknown.id);
  const { data: onb } = await admin.rpc("is_fully_onboarded", { p_user_id: unknown.id });
  check(onb === false, "affiliation unknown -> not fully onboarded", onb);
}

main()
  .catch((e) => {
    console.error("[smoke-affiliation-snapshot] threw:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    if (failureCount() > 0) {
      console.error(`[smoke-affiliation-snapshot] ${failureCount()} FAILED`);
      process.exitCode = 1;
    } else if (!process.exitCode) console.log("[smoke-affiliation-snapshot] ALL OK");
  });
