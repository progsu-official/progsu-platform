#!/usr/bin/env tsx
// Smoke: QR check-in path (D12, docs/09-events-platform-plan.md §7.5).
// checkin_token lifecycle on RSVP going/decline, admin_check_in_by_token
// happy path + duplicate + invalid token + non-admin rejection.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: versionRows } = await admin
    .from("consent_versions")
    .select("consent_type, version");
  const currentVersions = new Map<string, string>(
    (versionRows ?? []).map((r) => [r.consent_type as string, r.version as string])
  );

  async function makeUser(email: string, opts: { isAdmin?: boolean; fullyOnboarded?: boolean } = {}) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: email.split("@")[0], family_name: "Tester" },
    });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
    const uid = data.user.id;
    const y = new Date().getFullYear() + 1;
    if (opts.isAdmin) {
      await admin.from("profiles").update({ is_admin: true }).eq("id", uid);
    }
    if (opts.fullyOnboarded) {
      await admin
        .from("profiles")
        .update({
          first_name: email.split("@")[0],
          last_name: "QrCheckin",
          school: "Georgia State University",
          major: "computer_science",
          phone_number: "555-555-5555",
          class_standing: "junior",
          grad_year: y,
          grad_term: `Fall ${y}`,
          interested_roles: ["software_engineering"],
        })
        .eq("id", uid);
      await admin.from("resumes").insert({
        id: crypto.randomUUID(),
        user_id: uid,
        storage_path: `${uid}/smoke-qr-checkin.pdf`,
        file_name: "smoke-qr-checkin.pdf",
        file_size: 9,
        mime_type: "application/pdf",
        status: "active",
        is_current: true,
      });
      const ts = new Date().toISOString();
      await admin.from("consents").insert(
        ["privacy_policy", "terms_of_service", "age_confirmation"].map((t) => ({
          user_id: uid,
          consent_type: t,
          accepted: true,
          version: currentVersions.get(t) ?? "v1",
          accepted_at: ts,
        }))
      );
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
  const adminEmail = `admin-qr-${suffix}@example.com`;
  const memberEmail = `member-qr-${suffix}@example.com`;

  const adminUser = await makeUser(adminEmail, { isAdmin: true });
  const member = await makeUser(memberEmail, { fullyOnboarded: true });

  const adminClient = await userClient(adminEmail);
  const memberClient = await userClient(memberEmail);

  console.log(`[smoke-event-qr-checkin] seeded admin + going-candidate member`);

  const createdEventIds: string[] = [];
  try {
    const starts = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const ends = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { data: evId, error: cErr } = await adminClient.rpc("create_event", {
      p_payload: {
        slug: `ci-qr-smoke-${suffix}`,
        title: "QR Check-in Smoke Event",
        visibility: "members",
        starts_at: starts,
        ends_at: ends,
        capacity: null,
        waitlist_enabled: false,
      },
    });
    if (cErr || typeof evId !== "string") {
      throw new Error(`create_event: ${cErr?.message}`);
    }
    const eventId = evId;
    createdEventIds.push(eventId);
    await adminClient.rpc("publish_event", { p_event_id: eventId });
    console.log(`[smoke-event-qr-checkin] OK: event published`);

    // 1. RSVP going -> checkin_token gets set by the trigger.
    const { data: rsvpEff, error: rsvpErr } = await memberClient.rpc("rsvp_to_event", {
      p_event_id: eventId,
      p_desired: "going",
    });
    if (rsvpErr) throw new Error(`member rsvp: ${rsvpErr.message}`);
    if (rsvpEff !== "going") throw new Error(`member effective ${rsvpEff}`);

    const { data: rsvpRow } = await admin
      .from("event_rsvps")
      .select("checkin_token")
      .eq("event_id", eventId)
      .eq("user_id", member.id)
      .single();
    const token = rsvpRow?.checkin_token as string | null;
    if (!token) throw new Error(`expected checkin_token to be set on going RSVP`);
    console.log(`[smoke-event-qr-checkin] OK: checkin_token set on going RSVP`);

    // 2. Non-admin scan attempt -> P0001 'admin only'.
    const { error: nonAdminErr } = await memberClient.rpc("admin_check_in_by_token", {
      p_token: token,
    });
    if (!nonAdminErr || nonAdminErr.code !== "P0001") {
      throw new Error(`expected P0001 on non-admin scan, got ${nonAdminErr?.code}`);
    }
    console.log(`[smoke-event-qr-checkin] OK: non-admin admin_check_in_by_token -> P0001`);

    // 3. Admin scans the real token -> succeeds, method=qr_token.
    const { data: scanData, error: scanErr } = await adminClient.rpc(
      "admin_check_in_by_token",
      { p_token: token, p_note: "qr smoke" }
    );
    if (scanErr) throw new Error(`admin_check_in_by_token: ${scanErr.message}`);
    const scanRow = Array.isArray(scanData) ? scanData[0] : scanData;
    if (scanRow?.out_user_id !== member.id) {
      throw new Error(`expected resolved out_user_id=${member.id}, got ${scanRow?.out_user_id}`);
    }
    const { data: attRow } = await admin
      .from("event_attendances")
      .select("method, checked_in_by")
      .eq("event_id", eventId)
      .eq("user_id", member.id)
      .single();
    if (attRow?.method !== "qr_token") {
      throw new Error(`expected method=qr_token, got ${attRow?.method}`);
    }
    if (attRow?.checked_in_by !== adminUser.id) {
      throw new Error(`expected checked_in_by=admin, got ${attRow?.checked_in_by}`);
    }
    console.log(`[smoke-event-qr-checkin] OK: admin scan inserted method=qr_token`);

    // 4. Duplicate scan of the same token -> P0001 'already checked in'.
    const { error: dupErr } = await adminClient.rpc("admin_check_in_by_token", {
      p_token: token,
    });
    if (!dupErr) throw new Error("duplicate token scan should fail");
    if (dupErr.code !== "P0001" || !/already checked in/i.test(dupErr.message)) {
      throw new Error(`expected P0001 'already checked in', got ${dupErr.code}: ${dupErr.message}`);
    }
    console.log(`[smoke-event-qr-checkin] OK: duplicate scan -> P0001 'already checked in'`);

    // 5. Random/invalid token -> P0002 'invalid token'.
    const { error: invalidErr } = await adminClient.rpc("admin_check_in_by_token", {
      p_token: crypto.randomUUID(),
    });
    if (!invalidErr) throw new Error("invalid token scan should fail");
    if (invalidErr.code !== "P0002" || !/invalid token/i.test(invalidErr.message)) {
      throw new Error(`expected P0002 'invalid token', got ${invalidErr.code}: ${invalidErr.message}`);
    }
    console.log(`[smoke-event-qr-checkin] OK: invalid token -> P0002 'invalid token'`);

    // 6. RSVP flips to declined -> checkin_token cleared by the same trigger.
    const { error: declineErr } = await memberClient.rpc("rsvp_to_event", {
      p_event_id: eventId,
      p_desired: "declined",
    });
    if (declineErr) throw new Error(`decline rsvp: ${declineErr.message}`);
    const { data: clearedRow } = await admin
      .from("event_rsvps")
      .select("checkin_token")
      .eq("event_id", eventId)
      .eq("user_id", member.id)
      .single();
    if (clearedRow?.checkin_token !== null) {
      throw new Error(`expected checkin_token cleared on decline, got ${clearedRow?.checkin_token}`);
    }
    console.log(`[smoke-event-qr-checkin] OK: checkin_token cleared on decline`);

    console.log("[smoke-event-qr-checkin] ALL OK");
  } finally {
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const u of [adminUser, member]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-event-qr-checkin] FAILED:", err);
  process.exit(1);
});
