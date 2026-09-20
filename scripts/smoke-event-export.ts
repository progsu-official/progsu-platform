#!/usr/bin/env tsx
// Smoke: admin_event_analytics_for folds guest RSVPs into `going` (the
// 112-vs-464 divergence fixed in 20260920120000), and admin_event_export_for
// returns one row per registrant across all sources with the right gates.
//
// Hard rule 10: a new public function arrives with EXECUTE already granted to
// anon and authenticated via Supabase's default privileges, so both refusals
// are asserted here rather than assumed.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

type ExportRow = {
  attendee_type: string;
  full_name: string | null;
  school_email: string | null;
  google_email: string | null;
  rsvp_status: string | null;
  checked_in: boolean | null;
};

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  async function makeUser(email: string, opts: { isAdmin?: boolean } = {}) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: email.split("@")[0], family_name: "Tester" },
    });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
    if (opts.isAdmin) {
      await admin.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
    }
    return data.user;
  }

  async function userClient(email: string) {
    const c = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { error } = await c.auth.signInWithPassword({
      email,
      password: "testpassword-12345",
    });
    if (error) throw new Error(`signin ${email}: ${error.message}`);
    return c;
  }

  const suffix = Date.now();
  const adminEmail = `admin-export-${suffix}@example.com`;
  const aliceEmail = `alice-export-${suffix}@example.com`;
  const bobEmail = `bob-export-${suffix}@example.com`;
  const carolEmail = `carol-export-${suffix}@example.com`;

  const adminUser = await makeUser(adminEmail, { isAdmin: true });
  const alice = await makeUser(aliceEmail);
  const bob = await makeUser(bobEmail); // walk-in: check-in, never RSVPs
  const carol = await makeUser(carolEmail); // walk-in scanned in by QR

  const adminClient = await userClient(adminEmail);
  const aliceClient = await userClient(aliceEmail);
  const anonClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const createdEventIds: string[] = [];
  try {
    // Event already started, so the guest walk-in rule (guest RSVP created at
    // or after starts_at) has something to bite on.
    const starts = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ends = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { data: evId, error: cErr } = await adminClient.rpc("create_event", {
      p_payload: {
        slug: `export-smoke-${suffix}`,
        title: "Export Smoke Event",
        visibility: "members",
        starts_at: starts,
        ends_at: ends,
      },
    });
    if (cErr || typeof evId !== "string") {
      throw new Error(`create_event: ${cErr?.message}`);
    }
    const eventId = evId;
    createdEventIds.push(eventId);
    const { error: pubErr } = await adminClient.rpc("publish_event", {
      p_event_id: eventId,
    });
    if (pubErr) throw new Error(`publish_event: ${pubErr.message}`);

    // 1 member RSVP.
    const { error: aliceErr } = await aliceClient.rpc("rsvp_to_event", {
      p_event_id: eventId,
      p_desired: "going",
    });
    if (aliceErr) throw new Error(`alice rsvp: ${aliceErr.message}`);

    // 1 member walk-in: attendance with no RSVP row.
    const { error: ciErr } = await adminClient.rpc("admin_check_in_member", {
      p_event_id: eventId,
      p_user_id: bob.id,
      p_note: "smoke walk-in",
    });
    if (ciErr) throw new Error(`admin_check_in_member: ${ciErr.message}`);

    // 1 more member walk-in, scanned in by QR rather than clicked in. This is
    // the shape nearly every real check-in has, and the one the analytics
    // ignored until 20260920130000: qr_token counted toward neither side of
    // the self/admin split, and a no-RSVP attendance was only a walk-in when
    // its method was admin_click. Service-role insert — the token path has
    // its own smoke; this one only needs the row.
    const { error: qrErr } = await admin.from("event_attendances").insert({
      event_id: eventId,
      user_id: carol.id,
      method: "qr_token",
      checked_in_by: adminUser.id,
    });
    if (qrErr) throw new Error(`qr attendance: ${qrErr.message}`);

    // 3 guest RSVPs.
    const guestEmails = [
      `guest1-export-${suffix}@student.gsu.edu`,
      `guest2-export-${suffix}@student.gsu.edu`,
      `guest3-export-${suffix}@gmail.com`,
    ];
    for (const [i, gEmail] of guestEmails.entries()) {
      const { error: gErr } = await anonClient.rpc("guest_rsvp_to_event", {
        p_event_id: eventId,
        p_name: `Guest ${i + 1}`,
        p_email: gEmail,
        p_phone: "+14045550100",
        p_sms_opt_in: false,
        p_sms_consent_copy: null,
      });
      if (gErr) throw new Error(`guest rsvp ${gEmail}: ${gErr.message}`);
    }

    // Check one guest in (service-role insert — the token check-in path has
    // its own smoke; this one only needs the attendance row to exist).
    const { data: guestRows } = await admin
      .from("event_guest_rsvps")
      .select("id")
      .eq("event_id", eventId)
      .limit(1);
    const guestRsvpId = guestRows?.[0]?.id as string | undefined;
    if (!guestRsvpId) throw new Error("guest rsvp row missing");
    const { error: gaErr } = await admin.from("event_guest_attendances").insert({
      event_id: eventId,
      guest_rsvp_id: guestRsvpId,
      method: "admin_click",
      checked_in_by: adminUser.id,
    });
    if (gaErr) throw new Error(`guest attendance: ${gaErr.message}`);

    console.log("[smoke-event-export] seeded 1 member RSVP, 2 walk-ins, 3 guests");

    // ===== Analytics: going must fold guests =====
    const { data: analytics, error: anErr } = await adminClient.rpc(
      "admin_event_analytics_for",
      { p_event_id: eventId }
    );
    if (anErr) throw new Error(`analytics: ${anErr.message}`);
    const a = analytics as {
      rsvp: { going: number; members: number; guests: number; historical: number };
      attendance: {
        total: number;
        walk_ins: number;
        no_shows: number;
        self_code: number;
        admin_click: number;
      };
    };

    // 1 member going + 3 guests going. The pre-fix function returned 1.
    if (a.rsvp.going !== 4) {
      throw new Error(`rsvp.going expected 4, got ${a.rsvp.going}`);
    }
    if (a.rsvp.members !== 1 || a.rsvp.guests !== 3 || a.rsvp.historical !== 0) {
      throw new Error(
        `rsvp split expected 1/3/0, got ${a.rsvp.members}/${a.rsvp.guests}/${a.rsvp.historical}`
      );
    }
    console.log("[smoke-event-export] OK: analytics going = 4 (1 member + 3 guests)");

    // 2 member check-ins (bob, carol) + 1 guest check-in.
    if (a.attendance.total !== 3) {
      throw new Error(`attendance.total expected 3, got ${a.attendance.total}`);
    }
    // bob + carol (members, no RSVP, one clicked in and one QR-scanned) + the
    // guest, whose RSVP was created after starts_at.
    if (a.attendance.walk_ins !== 3) {
      throw new Error(`walk_ins expected 3, got ${a.attendance.walk_ins}`);
    }
    // All three were checked in by staff; carol's qr_token has to land on the
    // admin side or the split stops adding up to the total.
    if (a.attendance.self_code !== 0 || a.attendance.admin_click !== 3) {
      throw new Error(
        `method split expected 0 self / 3 admin, got ${a.attendance.self_code}/${a.attendance.admin_click}`
      );
    }
    // alice (going, no check-in) + 2 unchecked guests.
    if (a.attendance.no_shows !== 3) {
      throw new Error(`no_shows expected 3, got ${a.attendance.no_shows}`);
    }
    console.log("[smoke-event-export] OK: attendance folds guests and QR check-ins");

    // ===== Export: one row per registrant =====
    const { data: exportData, error: exErr } = await adminClient.rpc(
      "admin_event_export_for",
      { p_event_id: eventId }
    );
    if (exErr) throw new Error(`export: ${exErr.message}`);
    const rows = (exportData ?? []) as ExportRow[];

    // alice + bob and carol (walk-ins) + 3 guests.
    if (rows.length !== 6) {
      throw new Error(`export rows expected 6, got ${rows.length}`);
    }
    const members = rows.filter((r) => r.attendee_type === "member");
    const guests = rows.filter((r) => r.attendee_type === "guest");
    if (members.length !== 3 || guests.length !== 3) {
      throw new Error(
        `export split expected 3 members / 3 guests, got ${members.length}/${guests.length}`
      );
    }
    const walkIn = members.find((r) => r.rsvp_status === null);
    if (!walkIn || walkIn.checked_in !== true) {
      throw new Error("export missing the member walk-in row");
    }
    // .edu guests get school_email; the gmail one doesn't.
    const guestSchoolEmails = guests.filter((r) => r.school_email !== null);
    if (guestSchoolEmails.length !== 2) {
      throw new Error(
        `expected 2 guests with a school email, got ${guestSchoolEmails.length}`
      );
    }
    console.log("[smoke-event-export] OK: export returns 6 rows, sources split right");

    // ===== Gates =====
    const { error: nonAdminErr } = await aliceClient.rpc(
      "admin_event_export_for",
      { p_event_id: eventId }
    );
    if (!nonAdminErr) throw new Error("non-admin export was NOT refused");
    console.log("[smoke-event-export] OK: non-admin refused");

    const { error: anonErr } = await anonClient.rpc("admin_event_export_for", {
      p_event_id: eventId,
    });
    if (!anonErr) throw new Error("anon export was NOT refused");
    console.log("[smoke-event-export] OK: anon refused");

    // ===== Audit =====
    const { data: auditRows } = await admin
      .from("audit_log")
      .select("action")
      .eq("action", "event.export_csv")
      .contains("metadata", { event_id: eventId });
    if (!auditRows || auditRows.length < 1) {
      throw new Error("export wrote no event.export_csv audit row");
    }
    console.log("[smoke-event-export] OK: audit row written");

    console.log("[smoke-event-export] ALL OK");
  } finally {
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const u of [adminUser, alice, bob, carol]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-event-export] FAILED:", err);
  process.exit(1);
});
