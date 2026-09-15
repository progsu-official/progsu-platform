#!/usr/bin/env tsx
// Smoke: SMS event reminders (migration 20260915130000, docs/19 §8).
//
//   1. Recipient rule. Going member and going guest RSVPs who can be texted
//      are in; a going RSVP with no SMS consent, a waitlisted RSVP, and a
//      suppressed number are out. The same person RSVP'd twice is one text.
//   2. Due window. An event is due from 30 to 5 minutes before start, only
//      while published with send_sms_reminder on and not yet reminded.
//   3. Access. anon and members cannot reach any reminder function; only an
//      admin can toggle send_sms_reminder, and the toggle is audited.
//   4. Exactly once. The first enqueue stamps the event and snapshots the
//      recipients; the second is a no-op. Moving starts_at clears the stamp.
//
// Timing is simulated with p_now against an event seeded three hours out, so
// the live per-minute cron never finds it due. The enqueue step does create a
// real reminder broadcast for seeded 555-01XX numbers; it is cancelled the
// moment it exists. The claim-time re-checks are covered by the rolled-back
// transaction run described in docs/19 §8, not here, because claiming would
// race the live worker.

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
  const password = `sms-rem-${crypto.randomUUID()}`;
  const createdUserIds: string[] = [];
  const createdLegacyIds: string[] = [];
  let eventId: string | null = null;

  const offset = Math.floor(Math.random() * 100);
  const phone = (i: number) => `+1404555${String(100 + ((offset + i) % 100)).padStart(4, "0")}`;
  const P = {
    admin: phone(0),
    memberIn: phone(1),
    memberNoConsent: phone(2),
    memberWaitlisted: phone(3),
    guestIn: phone(4),
    guestSuppressed: phone(5),
  };
  const seededPhones = Object.values(P);

  const { data: versionRows } = await admin.from("consent_versions").select("consent_type, version");
  const smsVersion = (versionRows ?? []).find((r) => r.consent_type === "sms_marketing")?.version;
  if (!smsVersion) throw new Error("consent_versions has no sms_marketing row");

  async function seedUser(label: string, fields: Record<string, unknown>) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `smoke-smsrem-${label}-${suffix}@example.com`,
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
      email: `smoke-smsrem-${label}-${suffix}@example.com`,
      password,
    });
    if (error) throw new Error(`sign in ${label}: ${error.message}`);
    return client;
  }

  async function optIn(userId: string) {
    const { error } = await admin.from("consents").insert({
      user_id: userId,
      consent_type: "sms_marketing",
      accepted: true,
      version: smsVersion,
    });
    if (error) throw new Error(`consent: ${error.message}`);
  }

  async function recipients(id: string) {
    const { data, error } = await admin.rpc("sms_event_reminder_numbers", { p_event_id: id });
    if (error) throw new Error(`numbers: ${error.message}`);
    return new Set((data ?? []) as string[]);
  }

  try {
    for (const table of ["profiles", "legacy_members", "sms_suppressions"] as const) {
      const { count } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .in("phone_e164", seededPhones);
      if ((count ?? 0) > 0) throw new Error(`${table} already holds a seeded 555-01XX number`);
    }

    const adminId = await seedUser("admin", { is_admin: true, phone_number: P.admin });
    const memberIn = await seedUser("memberIn", { phone_number: P.memberIn });
    await optIn(memberIn);
    const memberNoConsent = await seedUser("memberNoConsent", { phone_number: P.memberNoConsent });
    const memberWaitlisted = await seedUser("memberWaitlisted", { phone_number: P.memberWaitlisted });
    await optIn(memberWaitlisted);
    const member = await signIn("memberNoConsent");
    const adminClient = await signIn("admin");

    const startsAt = new Date(Date.now() + 3 * 3600_000);
    const { data: ev, error: evErr } = await admin
      .from("events")
      .insert({
        title: `Smoke reminder ${suffix}`,
        slug: `smoke-sms-reminder-${suffix}`,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 3600_000).toISOString(),
        status: "published",
        visibility: "members",
        location_text: "Smoke Hall 1",
      })
      .select("id, send_sms_reminder")
      .single();
    if (evErr || !ev) throw new Error(`event: ${evErr?.message}`);
    eventId = ev.id as string;
    check("new events default to send_sms_reminder = true", ev.send_sms_reminder === true);

    const { error: rErr } = await admin.from("event_rsvps").insert([
      { event_id: eventId, user_id: memberIn, status: "going" },
      { event_id: eventId, user_id: memberNoConsent, status: "going" },
      { event_id: eventId, user_id: memberWaitlisted, status: "waitlisted" },
    ]);
    if (rErr) throw new Error(`member rsvps: ${rErr.message}`);
    // A guest RSVP for the member's own number too: one person, one text.
    const { error: gErr } = await admin.from("event_guest_rsvps").insert([
      { event_id: eventId, name: "Guest In", email: `guest-in-${suffix}@example.com`, phone: P.guestIn, status: "going" },
      { event_id: eventId, name: "Guest Supp", email: `guest-supp-${suffix}@example.com`, phone: P.guestSuppressed, status: "going" },
      { event_id: eventId, name: "Dup", email: `dup-${suffix}@example.com`, phone: `(${P.memberIn.slice(2, 5)}) ${P.memberIn.slice(5, 8)}-${P.memberIn.slice(8)}`, status: "going" },
    ]);
    if (gErr) throw new Error(`guest rsvps: ${gErr.message}`);
    for (const [label, p] of [["guestIn", P.guestIn], ["guestSupp", P.guestSuppressed]] as const) {
      const { data, error } = await admin
        .from("legacy_members")
        .insert({
          full_name: `${label} Smoke`, source: "smoke", source_detail: `smoke-smsrem-${suffix}`,
          personal_email: `${label.toLowerCase()}-${suffix}@example.com`,
          phone_number: p, phone_e164: p, sms_interest: true,
          sms_consent_at: new Date(Date.now() - 86_400_000).toISOString(), sms_consent_copy: "smoke",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`legacy ${label}: ${error?.message}`);
      createdLegacyIds.push(data.id as string);
    }
    await admin.rpc("suppress_sms_number", { p_phone: P.guestSuppressed, p_reason: "manual", p_note: "smoke" });

    console.log("\n1. recipient rule");
    const set = await recipients(eventId);
    check("going member who opted in is in", set.has(P.memberIn));
    check("going guest who opted in is in", set.has(P.guestIn));
    check("going member with no SMS consent is out", !set.has(P.memberNoConsent));
    check("waitlisted member is out", !set.has(P.memberWaitlisted));
    check("suppressed guest is out", !set.has(P.guestSuppressed));
    check("same person RSVP'd twice is one number", set.size === 2, [...set]);

    console.log("\n2. due window");
    const dueAt = async (minutesBefore: number) => {
      const { data, error } = await admin.rpc("due_event_sms_reminders", {
        p_now: new Date(startsAt.getTime() - minutesBefore * 60_000).toISOString(),
      });
      if (error) throw new Error(`due: ${error.message}`);
      return ((data ?? []) as Array<{ event_id: string }>).some((r) => r.event_id === eventId);
    };
    check("not due 45 min before", !(await dueAt(45)));
    check("due 30 min before", await dueAt(30));
    check("due 10 min before", await dueAt(10));
    check("not due 4 min before", !(await dueAt(4)));
    const { data: liveDue } = await admin.rpc("due_event_sms_reminders");
    check("not due to the live cron right now", !((liveDue ?? []) as Array<{ event_id: string }>).some((r) => r.event_id === eventId));

    console.log("\n3. access");
    for (const [fn, args] of [
      ["due_event_sms_reminders", {}],
      ["enqueue_event_sms_reminder", { p_event_id: eventId, p_body: "x STOP" }],
      ["sms_event_reminder_numbers", { p_event_id: eventId }],
      ["sms_is_event_reminder_recipient", { p_event_id: eventId, p_phone_e164: P.memberIn }],
    ] as const) {
      const a = await anon.rpc(fn, args);
      check(`anon denied: ${fn}`, DENIED.test(a.error?.message ?? ""), a.error?.message);
      const m = await member.rpc(fn, args);
      check(`member denied: ${fn}`, DENIED.test(m.error?.message ?? ""), m.error?.message);
      const ad = await adminClient.rpc(fn, args);
      check(`admin (authenticated) denied: ${fn}`, DENIED.test(ad.error?.message ?? ""), ad.error?.message);
    }
    const anonToggle = await anon.rpc("set_event_sms_reminder", { p_event_id: eventId, p_enabled: false });
    check("anon denied: set_event_sms_reminder", DENIED.test(anonToggle.error?.message ?? ""), anonToggle.error?.message);
    const memberToggle = await member.rpc("set_event_sms_reminder", { p_event_id: eventId, p_enabled: false });
    check("member refused: set_event_sms_reminder", /admin only/.test(memberToggle.error?.message ?? ""), memberToggle.error?.message);

    const off = await adminClient.rpc("set_event_sms_reminder", { p_event_id: eventId, p_enabled: false });
    check("admin can turn reminders off", !off.error, off.error?.message);
    check("turned off => not due", !(await dueAt(20)));
    const { count: toggles } = await admin
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "event.sms_reminder_toggled")
      .eq("actor_user_id", adminId);
    check("toggle is audited with the officer", toggles === 1, toggles);
    await adminClient.rpc("set_event_sms_reminder", { p_event_id: eventId, p_enabled: true });

    console.log("\n4. exactly once");
    const simNow = new Date(startsAt.getTime() - 20 * 60_000).toISOString();
    const noStop = await admin.rpc("enqueue_event_sms_reminder", { p_event_id: eventId, p_body: "no opt out", p_now: simNow });
    check("body without STOP is refused", /STOP/.test(noStop.error?.message ?? ""), noStop.error?.message);

    const first = await admin.rpc("enqueue_event_sms_reminder", {
      p_event_id: eventId,
      p_body: "yo, smoke starts in 30 min! Progsu: reply STOP to opt out",
      p_now: simNow,
    });
    const broadcastId = first.data?.broadcast_id as string | undefined;
    if (broadcastId) {
      // Out of the live worker's reach before asserting anything else.
      await adminClient.rpc("cancel_sms_broadcast", { p_broadcast_id: broadcastId });
    }
    check("first enqueue queues both recipients", first.data?.enqueued === true && first.data?.recipient_count === 2, first.error?.message ?? first.data);
    const { data: stamped } = await admin.from("events").select("sms_reminder_sent_at").eq("id", eventId).single();
    check("event is stamped", stamped?.sms_reminder_sent_at != null);
    const second = await admin.rpc("enqueue_event_sms_reminder", {
      p_event_id: eventId,
      p_body: "yo, smoke starts in 30 min! Progsu: reply STOP to opt out",
      p_now: simNow,
    });
    check("second enqueue is a no-op", second.data?.enqueued === false, second.data);
    const { data: bRow } = await admin.from("sms_broadcasts").select("audience, event_id, status").eq("id", broadcastId ?? "").single();
    check("reminder broadcast is linked to the event", bRow?.audience === "event_reminder" && bRow?.event_id === eventId, bRow);

    await admin
      .from("events")
      .update({
        starts_at: new Date(startsAt.getTime() + 3600_000).toISOString(),
        ends_at: new Date(startsAt.getTime() + 7200_000).toISOString(),
      })
      .eq("id", eventId);
    const { data: moved } = await admin.from("events").select("sms_reminder_sent_at").eq("id", eventId).single();
    check("rescheduling clears the stamp", moved?.sms_reminder_sent_at === null, moved);
  } finally {
    if (eventId) {
      await admin.from("sms_broadcasts").delete().eq("event_id", eventId);
      const { error } = await admin.from("events").delete().eq("id", eventId);
      if (error) console.error("  cleanup: event", error.message);
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
    console.error(`\n[smoke-sms-event-reminders] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\n[smoke-sms-event-reminders] all checks passed");
}

main().catch((err) => {
  console.error("[smoke-sms-event-reminders] FAILED:", err);
  process.exit(1);
});
