#!/usr/bin/env tsx
// Smoke: SMS broadcasts (migration 20260915120000, docs/19-sms-broadcasts.md).
//
//   1. Recipient rule. sms_is_sendable() accepts a member ledger opt-in and a
//      guest opt-in with a timestamp; refuses a bare sms_interest, a
//      suppressed number, and an archived profile; lets the NEWER of a guest
//      opt-in and a member decline win in both directions; applies the GSU
//      filter from either source; and stops counting a claimed guest opt-in
//      once the member moved number, was archived, or deleted the account.
//   2. Access model. Both tables are closed to clients. anon reaches nothing.
//      A member cannot create a broadcast, and cannot reach the resolver or
//      any worker function at all. Refusals are asserted as permission
//      denied, not just "some error", because each worker function also
//      refuses non-service callers internally and would mask a missing revoke
//      (CLAUDE.md hard rule #10).
//   3. Send guards. No STOP in the body and a stale confirmed count are
//      refused and write nothing; a second in-flight broadcast is refused by
//      the unique index, not only the readable pre-check.
//   4. Worker path. A number suppressed after enqueue is closed out at claim
//      and never handed to the worker; Twilio 21610 lands in sms_suppressions;
//      delivery receipts only move a row forward; unsent rows can be released
//      and a sent one cannot; a row lost mid-send fails instead of
//      re-queueing; cancel stops everything still queued.
//
// Everything is seeded with fictional 555-01XX numbers and removed in the
// finally block. It only ever creates self_test broadcasts through the
// officer path: a real-audience broadcast here would enqueue real people.
//
// Claiming is global. The run refuses to start while any other delivery is
// queued or sending, and every claim is checked: a row that is not this run's
// is released straight back to the queue (it was never sent) and the run
// fails. Run it with FEATURE_SMS off on the deployment so the live cron is not
// draining the same queue.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

let failures = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail === undefined ? "" : detail);
  }
}

const DENIED = /permission denied/i;

type ClaimedRow = { delivery_id: string; to_phone: string; message_body: string };

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

  const admin = createClient(url, SUPABASE_SERVICE_ROLE_KEY, noSession);
  const anon = createClient(url, anonKey, noSession);

  const suffix = Date.now().toString(36);
  const password = `sms-smoke-${crypto.randomUUID()}`;
  const createdUserIds: string[] = [];
  const createdLegacyIds: string[] = [];
  const ownDeliveryIds = new Set<string>();

  // 555-0100..0199 is reserved for fiction, so none of these can belong to a
  // real person. Offset per run so two runs rarely overlap.
  const offset = Math.floor(Math.random() * 100);
  const phone = (i: number) =>
    `+1404555${String(100 + ((offset + i) % 100)).padStart(4, "0")}`;
  const P = {
    adminA: phone(0),
    adminB: phone(1),
    adminC: phone(2),
    memberOptIn: phone(3),
    guestGsu: phone(4),
    guestThenDeclined: phone(5),
    interestOnly: phone(6),
    guestOtherSchool: phone(7),
    declinedThenGuest: phone(8),
    archived: phone(9),
    movedFrom: phone(10),
    movedTo: phone(11),
    deletedAccount: phone(12),
    claimedArchived: phone(13),
    claimedLive: phone(14),
  };
  const seededPhones = Object.values(P);

  const { data: versionRows } = await admin.from("consent_versions").select("consent_type, version");
  const versions = new Map(
    (versionRows ?? []).map((r) => [r.consent_type as string, r.version as string])
  );
  const smsVersion = versions.get("sms_marketing");
  if (!smsVersion) throw new Error("consent_versions has no sms_marketing row");

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  async function seedUser(label: string, fields: Record<string, unknown>): Promise<string> {
    const email = `smoke-sms-${label}-${suffix}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create ${label}: ${error?.message}`);
    createdUserIds.push(data.user.id);
    const { error: pErr } = await admin
      .from("profiles")
      .update({ first_name: label, last_name: "Smoke", ...fields })
      .eq("id", data.user.id);
    if (pErr) throw new Error(`profile ${label}: ${pErr.message}`);
    return data.user.id;
  }

  async function signIn(label: string) {
    const client = createClient(url, anonKey, noSession);
    const { error } = await client.auth.signInWithPassword({
      email: `smoke-sms-${label}-${suffix}@example.com`,
      password,
    });
    if (error) throw new Error(`sign in ${label}: ${error.message}`);
    return client;
  }

  async function smsConsent(userId: string, accepted: boolean, at: string) {
    const { error } = await admin.from("consents").insert({
      user_id: userId,
      consent_type: "sms_marketing",
      accepted,
      version: smsVersion,
      accepted_at: at,
    });
    if (error) throw new Error(`consent: ${error.message}`);
  }

  async function seedLegacy(label: string, p: string, fields: Record<string, unknown>) {
    const { data, error } = await admin
      .from("legacy_members")
      .insert({
        full_name: `${label} Smoke`,
        source: "smoke",
        source_detail: `smoke-sms-${suffix}`,
        campus_email: `${label.toLowerCase()}-${suffix}@student.gsu.edu`,
        phone_number: p,
        phone_e164: p,
        sms_interest: true,
        sms_consent_copy: "smoke",
        ...fields,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`legacy ${label}: ${error?.message}`);
    createdLegacyIds.push(data.id as string);
  }

  async function sendable(p: string, audience: "gsu" | "all_consented") {
    const { data, error } = await admin.rpc("sms_is_sendable", {
      p_phone_e164: p,
      p_audience: audience,
    });
    if (error) throw new Error(`sms_is_sendable: ${error.message}`);
    return data === true;
  }

  async function deliveriesFor(broadcastId: string) {
    const { data } = await admin
      .from("sms_deliveries")
      .select("id, phone_e164, status, error_code, error_message, twilio_sid")
      .eq("broadcast_id", broadcastId);
    for (const d of data ?? []) ownDeliveryIds.add(d.id as string);
    return data ?? [];
  }

  // Claims anything queued. Anything that is not this run's goes straight
  // back (it was never sent) and fails the run.
  async function claim(limit = 50): Promise<ClaimedRow[]> {
    const { data, error } = await admin.rpc("claim_sms_deliveries", { p_limit: limit });
    if (error) throw new Error(`claim: ${error.message}`);
    const rows = (data ?? []) as ClaimedRow[];
    const foreign = rows.filter((r) => !ownDeliveryIds.has(r.delivery_id));
    if (foreign.length > 0) {
      await admin.rpc("release_sms_deliveries", { p_ids: foreign.map((r) => r.delivery_id) });
      throw new Error(`claimed ${foreign.length} delivery row(s) that are not this run's; released them and stopped`);
    }
    return rows;
  }

  async function createTest(client: typeof anon, body: string) {
    const res = await client.rpc("create_sms_broadcast", { p_body: body, p_audience: "self_test" });
    if (!res.error) await deliveriesFor(res.data.broadcast_id as string);
    return res;
  }

  try {
    const { count: inFlight } = await admin
      .from("sms_deliveries")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "sending"]);
    const { count: sending } = await admin
      .from("sms_broadcasts")
      .select("*", { count: "exact", head: true })
      .eq("status", "sending");
    if ((inFlight ?? 0) > 0 || (sending ?? 0) > 0) {
      throw new Error("a broadcast is in flight; this smoke claims globally and will not run alongside it");
    }

    // Refuse to run on top of leftovers: every assertion below assumes these
    // numbers mean only what this run seeds.
    for (const table of ["profiles", "legacy_members", "sms_suppressions"] as const) {
      const { count } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .in("phone_e164", seededPhones);
      if ((count ?? 0) > 0) {
        throw new Error(`${table} already holds a seeded 555-01XX number; clean up a previous run first`);
      }
    }

    console.log("\n1. recipient rule");

    const adminA = await seedUser("adminA", { is_admin: true, phone_number: P.adminA });
    await seedUser("adminB", { is_admin: true, phone_number: P.adminB });
    await seedUser("adminC", { is_admin: true, phone_number: P.adminC });

    const member = await seedUser("member", {
      phone_number: P.memberOptIn,
      student_email: `member-${suffix}@student.gsu.edu`,
    });
    await smsConsent(member, true, daysAgo(3));

    await seedLegacy("guestGsu", P.guestGsu, { sms_consent_at: daysAgo(10) });

    const declined = await seedUser("declined", { phone_number: P.guestThenDeclined });
    await seedLegacy("guestThenDeclined", P.guestThenDeclined, { sms_consent_at: daysAgo(30) });
    await smsConsent(declined, false, daysAgo(2));

    await seedLegacy("interestOnly", P.interestOnly, {});

    await seedLegacy("otherSchool", P.guestOtherSchool, {
      campus_email: `other-${suffix}@students.kennesaw.edu`,
      sms_consent_at: daysAgo(4),
    });

    const reOpted = await seedUser("reOpted", { phone_number: P.declinedThenGuest });
    await smsConsent(reOpted, false, daysAgo(20));
    await seedLegacy("declinedThenGuest", P.declinedThenGuest, { sms_consent_at: daysAgo(5) });

    const archived = await seedUser("archived", {
      phone_number: P.archived,
      student_email: `archived-${suffix}@student.gsu.edu`,
      is_archived: true,
    });
    await smsConsent(archived, true, daysAgo(1));

    // Claimed guest records.
    const mover = await seedUser("mover", { phone_number: P.movedTo });
    await seedLegacy("movedFrom", P.movedFrom, {
      sms_consent_at: daysAgo(40),
      claimed_at: daysAgo(30),
      claimed_profile_id: mover,
    });
    await seedLegacy("deletedAccount", P.deletedAccount, {
      sms_consent_at: daysAgo(40),
      claimed_at: daysAgo(30),
      claimed_profile_id: null,
    });
    const claimedArchived = await seedUser("claimedArchived", {
      phone_number: P.claimedArchived,
      is_archived: true,
    });
    await seedLegacy("claimedArchived", P.claimedArchived, {
      sms_consent_at: daysAgo(40),
      claimed_at: daysAgo(30),
      claimed_profile_id: claimedArchived,
    });
    const claimedLive = await seedUser("claimedLive", { phone_number: P.claimedLive });
    await seedLegacy("claimedLive", P.claimedLive, {
      sms_consent_at: daysAgo(40),
      claimed_at: daysAgo(30),
      claimed_profile_id: claimedLive,
    });

    check("member ledger opt-in is sendable (gsu)", await sendable(P.memberOptIn, "gsu"));
    check("guest opt-in with timestamp is sendable (gsu)", await sendable(P.guestGsu, "gsu"));
    check(
      "guest opt-in followed by a member decline is NOT sendable",
      !(await sendable(P.guestThenDeclined, "all_consented"))
    );
    check(
      "member decline followed by a guest opt-in IS sendable",
      await sendable(P.declinedThenGuest, "all_consented")
    );
    check("bare sms_interest is NOT sendable", !(await sendable(P.interestOnly, "all_consented")));
    check("other-school opt-in is excluded from gsu", !(await sendable(P.guestOtherSchool, "gsu")));
    check("other-school opt-in is in all_consented", await sendable(P.guestOtherSchool, "all_consented"));
    check("archived profile opt-in is NOT sendable", !(await sendable(P.archived, "all_consented")));
    check("guest opt-in on a number the member moved away from is NOT sendable", !(await sendable(P.movedFrom, "all_consented")));
    check("guest opt-in whose claiming account was deleted is NOT sendable", !(await sendable(P.deletedAccount, "all_consented")));
    check("guest opt-in claimed by an archived member is NOT sendable", !(await sendable(P.claimedArchived, "all_consented")));
    check("guest opt-in claimed by a live member on the same number IS sendable", await sendable(P.claimedLive, "all_consented"));
    check("self_test is not an audience the resolver accepts", !(await sendable(P.guestGsu, "self_test" as "gsu")));

    const { error: supErr } = await admin.rpc("suppress_sms_number", {
      p_phone: P.guestGsu,
      p_reason: "manual",
      p_note: "smoke",
    });
    check("suppress_sms_number on service role", !supErr, supErr?.message);
    check("suppressed number is NOT sendable", !(await sendable(P.guestGsu, "gsu")));

    const { data: audience } = await admin.rpc("sms_audience_numbers", { p_audience: "all_consented" });
    const audienceSet = new Set((audience ?? []) as string[]);
    const expectIn = [P.memberOptIn, P.guestOtherSchool, P.declinedThenGuest, P.claimedLive];
    const expectOut = [
      P.guestGsu, P.guestThenDeclined, P.interestOnly, P.archived,
      P.movedFrom, P.deletedAccount, P.claimedArchived,
    ];
    check(
      "sms_audience_numbers matches the per-number rule for every seeded number",
      expectIn.every((p) => audienceSet.has(p)) && expectOut.every((p) => !audienceSet.has(p))
    );

    console.log("\n2. access model");

    const memberClient = await signIn("member");
    const adminAClient = await signIn("adminA");
    const adminBClient = await signIn("adminB");
    const adminCClient = await signIn("adminC");

    const directWrites: Record<string, Record<string, unknown>> = {
      sms_broadcasts: { body: "Progsu. Reply STOP to opt out.", audience: "gsu" },
      sms_deliveries: { broadcast_id: crypto.randomUUID(), phone_e164: P.memberOptIn },
    };
    for (const [table, row] of Object.entries(directWrites)) {
      const a = await anon.from(table).select("id").limit(1);
      check(`anon cannot read ${table}`, DENIED.test(a.error?.message ?? ""), a.error?.message ?? a.data);
      const m = await memberClient.from(table).select("id").limit(1);
      check(`member cannot read ${table}`, DENIED.test(m.error?.message ?? ""), m.error?.message ?? m.data);
      const w = await adminAClient.from(table).insert(row);
      check(`admin cannot write ${table} directly`, DENIED.test(w.error?.message ?? ""), w.error?.message);
    }

    const officerFns: Array<[string, Record<string, unknown>]> = [
      ["admin_sms_overview", {}],
      ["create_sms_broadcast", { p_body: "Hi. Reply STOP to opt out.", p_audience: "self_test" }],
      ["cancel_sms_broadcast", { p_broadcast_id: crypto.randomUUID() }],
    ];
    const serviceFns: Array<[string, Record<string, unknown>]> = [
      ["sms_is_sendable", { p_phone_e164: P.memberOptIn, p_audience: "gsu" }],
      ["sms_audience_numbers", { p_audience: "gsu" }],
      ["claim_sms_deliveries", { p_limit: 1 }],
      ["finish_sms_delivery", { p_delivery_id: crypto.randomUUID(), p_ok: true }],
      ["release_sms_deliveries", { p_ids: [crypto.randomUUID()] }],
      ["record_sms_status", { p_twilio_sid: "SMx", p_status: "delivered" }],
      ["complete_sms_broadcast_if_drained", { p_broadcast_id: crypto.randomUUID() }],
    ];
    for (const [fn, args] of [...officerFns, ...serviceFns]) {
      const { error } = await anon.rpc(fn, args);
      check(`anon denied: ${fn}`, DENIED.test(error?.message ?? ""), error?.message);
    }
    for (const [fn, args] of officerFns) {
      const { error } = await memberClient.rpc(fn, args);
      check(`member refused: ${fn}`, /admin only/.test(error?.message ?? ""), error?.message);
    }
    for (const [fn, args] of serviceFns) {
      const { error } = await memberClient.rpc(fn, args);
      check(`member denied: ${fn}`, DENIED.test(error?.message ?? ""), error?.message);
      const { error: aErr } = await adminAClient.rpc(fn, args);
      check(`admin (authenticated) denied: ${fn}`, DENIED.test(aErr?.message ?? ""), aErr?.message);
    }

    const { data: overview, error: ovErr } = await adminAClient.rpc("admin_sms_overview");
    check("admin overview loads", !ovErr, ovErr?.message);
    check(
      "overview shows the officer's own last 4, never a number",
      overview?.self?.has_phone === true && overview?.self?.phone_last4 === P.adminA.slice(-4)
    );

    console.log("\n3. send guards");

    const noStop = await adminAClient.rpc("create_sms_broadcast", {
      p_body: "Progsu: meeting tonight",
      p_audience: "self_test",
    });
    check("body without STOP is refused", /STOP/.test(noStop.error?.message ?? ""), noStop.error?.message);

    const stale = await adminAClient.rpc("create_sms_broadcast", {
      p_body: "Progsu smoke. Reply STOP to opt out.",
      p_audience: "all_consented",
      p_expected_count: -1,
    });
    check("stale confirmed count is refused", /audience changed/.test(stale.error?.message ?? ""), stale.error?.message);
    const { count: realRows } = await admin
      .from("sms_broadcasts")
      .select("*", { count: "exact", head: true })
      .in("created_by", createdUserIds)
      .neq("audience", "self_test");
    check("a refused real-audience create wrote nothing", (realRows ?? 0) === 0, realRows);

    // The unique index, exercised directly with empty broadcasts so nothing
    // is ever enqueued for a real person. Deleted immediately.
    const first = await admin
      .from("sms_broadcasts")
      .insert({ body: "smoke index. STOP", audience: "gsu", status: "sending", created_by: adminA })
      .select("id")
      .single();
    const second = await admin
      .from("sms_broadcasts")
      .insert({ body: "smoke index 2. STOP", audience: "all_consented", status: "sending", created_by: adminA })
      .select("id")
      .single();
    check("a second in-flight broadcast violates the unique index", second.error?.code === "23505", second.error);
    const viaHelper = await adminAClient.rpc("create_sms_broadcast", {
      p_body: "Progsu smoke. Reply STOP to opt out.",
      p_audience: "gsu",
      p_expected_count: 1,
    });
    check("create reports an in-flight broadcast readably", /still sending/.test(viaHelper.error?.message ?? ""), viaHelper.error?.message);
    await admin.from("sms_broadcasts").delete().in("id", [first.data?.id, second.data?.id].filter(Boolean));

    console.log("\n4. worker path");

    const testA = await createTest(adminAClient, "Progsu smoke A. Reply STOP to opt out.");
    const testB = await createTest(adminBClient, "Progsu smoke B. Reply STOP to opt out.");
    const testC = await createTest(adminCClient, "Progsu smoke C. Reply STOP to opt out.");
    check("self tests created", !testA.error && !testB.error && !testC.error, [
      testA.error?.message,
      testB.error?.message,
      testC.error?.message,
    ]);
    const idA = testA.data?.broadcast_id as string;
    const idB = testB.data?.broadcast_id as string;
    const idC = testC.data?.broadcast_id as string;

    const [dA] = await deliveriesFor(idA);
    check("self test targets the officer's own profile number", dA?.phone_e164 === P.adminA);

    const { data: auditRows } = await admin
      .from("audit_log")
      .select("metadata")
      .eq("action", "sms.test_sent")
      .eq("actor_user_id", adminA);
    check(
      "self test is audited with the officer and the destination number",
      (auditRows ?? []).length === 1 && auditRows![0].metadata?.phone_e164 === P.adminA,
      auditRows
    );

    // adminA's number opts out between Send and the worker reaching it.
    await admin.rpc("suppress_sms_number", { p_phone: P.adminA, p_reason: "stop_keyword" });

    const claimedRows = await claim();
    const claimedPhones = new Set(claimedRows.map((r) => r.to_phone));
    check("suppressed-after-enqueue number is never handed to the worker", !claimedPhones.has(P.adminA));
    check("the other two are", claimedPhones.has(P.adminB) && claimedPhones.has(P.adminC), [...claimedPhones]);
    check("claim carries the broadcast body", claimedRows.every((r) => /Progsu smoke/.test(r.message_body)));
    check("suppressed row is closed out at claim", (await deliveriesFor(idA))[0]?.status === "suppressed");

    const rowB = claimedRows.find((r) => r.to_phone === P.adminB)!;
    const rowC = claimedRows.find((r) => r.to_phone === P.adminC)!;

    await admin.rpc("finish_sms_delivery", {
      p_delivery_id: rowB.delivery_id,
      p_ok: false,
      p_error_code: "21610",
      p_error_message: "Attempt to send to unsubscribed recipient",
    });
    check("Twilio 21610 marks the delivery suppressed", (await deliveriesFor(idB))[0]?.status === "suppressed");
    const { data: supB } = await admin.from("sms_suppressions").select("reason").eq("phone_e164", P.adminB);
    check("Twilio 21610 adds the number to sms_suppressions", supB?.[0]?.reason === "carrier", supB);

    const sid = `SMsmoke${suffix}`;
    await admin.rpc("finish_sms_delivery", { p_delivery_id: rowC.delivery_id, p_ok: true, p_twilio_sid: sid });
    check("successful send is recorded as sent", (await deliveriesFor(idC))[0]?.status === "sent");
    const { data: releasedSent } = await admin.rpc("release_sms_deliveries", { p_ids: [rowC.delivery_id] });
    check("a row with a Twilio SID is never released", releasedSent === 0, releasedSent);
    await admin.rpc("record_sms_status", { p_twilio_sid: sid, p_status: "delivered" });
    check("delivered receipt advances the row", (await deliveriesFor(idC))[0]?.status === "delivered");
    await admin.rpc("record_sms_status", { p_twilio_sid: sid, p_status: "sent" });
    check("a late 'sent' receipt does not move it back", (await deliveriesFor(idC))[0]?.status === "delivered");
    await admin.rpc("finish_sms_delivery", { p_delivery_id: rowC.delivery_id, p_ok: false, p_error_code: "1" });
    check("a duplicate finish is ignored", (await deliveriesFor(idC))[0]?.status === "delivered");

    const { data: settled } = await admin.from("sms_broadcasts").select("id, status").in("id", [idA, idB, idC]);
    check(
      "every drained broadcast is marked done",
      (settled ?? []).length === 3 && (settled ?? []).every((b) => b.status === "done"),
      settled
    );

    const againA = await adminAClient.rpc("create_sms_broadcast", {
      p_body: "Progsu smoke A2. Reply STOP to opt out.",
      p_audience: "self_test",
    });
    check("test to a suppressed number is refused", /do-not-text/.test(againA.error?.message ?? ""), againA.error?.message);

    // Out of time budget before sending: release puts it back and it is
    // claimable again.
    const budget = await createTest(adminCClient, "Progsu smoke budget. Reply STOP to opt out.");
    const idBudget = budget.data?.broadcast_id as string;
    const firstClaim = await claim();
    const { data: releasedCount } = await admin.rpc("release_sms_deliveries", {
      p_ids: firstClaim.map((r) => r.delivery_id),
    });
    check("an unsent claimed row is released", releasedCount === 1, releasedCount);
    check("a released row is queued again", (await deliveriesFor(idBudget))[0]?.status === "queued");
    const secondClaim = await claim();
    check("a released row is claimable again", secondClaim.length === 1);
    await admin.rpc("finish_sms_delivery", { p_delivery_id: secondClaim[0]?.delivery_id, p_ok: true, p_twilio_sid: `${sid}b` });

    // A worker killed after claiming must not turn into a second text.
    const lost = await createTest(adminCClient, "Progsu smoke lost. Reply STOP to opt out.");
    const idLost = lost.data?.broadcast_id as string;
    await claim();
    await admin
      .from("sms_deliveries")
      .update({ claimed_at: new Date(Date.now() - 31 * 60_000).toISOString() })
      .eq("broadcast_id", idLost);
    const reclaimed = await claim();
    const [dLost] = await deliveriesFor(idLost);
    check("a row lost mid-send is not re-claimed", reclaimed.length === 0);
    check("a row lost mid-send is failed", dLost?.status === "failed", dLost);

    const toCancel = await createTest(adminCClient, "Progsu smoke cancel. Reply STOP to opt out.");
    const idCancel = toCancel.data?.broadcast_id as string;
    const memberCancel = await memberClient.rpc("cancel_sms_broadcast", { p_broadcast_id: idCancel });
    check("member cannot cancel", /admin only/.test(memberCancel.error?.message ?? ""), memberCancel.error?.message);
    const cancelled = await adminCClient.rpc("cancel_sms_broadcast", { p_broadcast_id: idCancel });
    check("admin cancel reports the unsent row", cancelled.data?.unsent === 1, cancelled.error?.message);
    check("nothing is claimable after cancel", (await claim()).length === 0);
    check("cancelled row stays cancelled", (await deliveriesFor(idCancel))[0]?.status === "cancelled");
  } finally {
    // created_by is ON DELETE SET NULL, so broadcasts go before their authors.
    if (createdUserIds.length > 0) {
      const { error } = await admin.from("sms_broadcasts").delete().in("created_by", createdUserIds);
      if (error) console.error("  cleanup: sms_broadcasts", error.message);
    }
    {
      const { error } = await admin.from("sms_suppressions").delete().in("phone_e164", seededPhones);
      if (error) console.error("  cleanup: sms_suppressions", error.message);
    }
    if (createdLegacyIds.length > 0) {
      const { error } = await admin.from("legacy_members").delete().in("id", createdLegacyIds);
      if (error) console.error("  cleanup: legacy_members", error.message);
    }
    for (const uid of createdUserIds) {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.error(`  cleanup: user ${uid}`, error.message);
    }
  }

  if (failures > 0) {
    console.error(`\n[smoke-sms-broadcast] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\n[smoke-sms-broadcast] all checks passed");
}

main().catch((err) => {
  console.error("[smoke-sms-broadcast] FAILED:", err);
  process.exit(1);
});
