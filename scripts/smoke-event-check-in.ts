#!/usr/bin/env tsx
// Smoke: admin_check_in_member for walk-ins, non-admin rejection,
// correct_attendance 'remove'. The self-check-in / shared-code path (D5)
// was cut entirely (D13, 2026-08-17), see scripts/smoke-event-qr-checkin.ts
// for the QR path that replaced it.

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
          last_name: "Checkin",
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
        storage_path: `${uid}/smoke-checkin.pdf`,
        file_name: "smoke-checkin.pdf",
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
  const adminEmail = `admin-ci-${suffix}@example.com`;
  const walkinEmail = `walkin-ci-${suffix}@example.com`; // no rsvp
  const memberEmail = `member-ci-${suffix}@example.com`; // used only for the non-admin rejection check

  const adminUser = await makeUser(adminEmail, { isAdmin: true });
  const walkin = await makeUser(walkinEmail, { fullyOnboarded: true });
  const member = await makeUser(memberEmail, { fullyOnboarded: true });

  const adminClient = await userClient(adminEmail);
  const memberClient = await userClient(memberEmail);

  console.log(`[smoke-event-check-in] seeded admin, walkin, non-admin member`);

  const createdEventIds: string[] = [];
  try {
    const starts = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const ends = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { data: evId, error: cErr } = await adminClient.rpc("create_event", {
      p_payload: {
        slug: `ci-smoke-${suffix}`,
        title: "Check-in Smoke Event",
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
    console.log(`[smoke-event-check-in] OK: event published`);

    // 1. Admin checks in walk-in (no RSVP) → succeeds.
    const { error: walkErr } = await adminClient.rpc("admin_check_in_member", {
      p_event_id: eventId,
      p_user_id: walkin.id,
      p_note: "walk-in smoke",
    });
    if (walkErr) throw new Error(`admin_check_in_member: ${walkErr.message}`);
    const { data: walkRow } = await admin
      .from("event_attendances")
      .select("method, checked_in_by")
      .eq("event_id", eventId)
      .eq("user_id", walkin.id)
      .single();
    if (walkRow?.method !== "admin_click") {
      throw new Error(`expected admin_click, got ${walkRow?.method}`);
    }
    if (walkRow?.checked_in_by !== adminUser.id) {
      throw new Error(
        `expected admin checked_in_by=${adminUser.id}, got ${walkRow?.checked_in_by}`
      );
    }
    console.log(
      `[smoke-event-check-in] OK: admin_check_in_member inserted method=admin_click for walk-in`
    );

    // 2. Non-admin admin_check_in_member → P0001.
    const { error: nonAdminErr } = await memberClient.rpc(
      "admin_check_in_member",
      {
        p_event_id: eventId,
        p_user_id: walkin.id,
      }
    );
    if (!nonAdminErr || nonAdminErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on member admin_check_in, got ${nonAdminErr?.code}`
      );
    }
    console.log(
      `[smoke-event-check-in] OK: non-admin admin_check_in_member → P0001`
    );

    // 3. Admin correct_attendance 'remove' for walk-in → row deleted + audit.
    const { error: corrErr } = await adminClient.rpc("correct_attendance", {
      p_event_id: eventId,
      p_user_id: walkin.id,
      p_action: "remove",
    });
    if (corrErr) throw new Error(`correct_attendance remove: ${corrErr.message}`);
    const { data: gone } = await admin
      .from("event_attendances")
      .select("user_id")
      .eq("event_id", eventId)
      .eq("user_id", walkin.id);
    if (gone && gone.length > 0) {
      throw new Error(`walk-in row not removed after correct_attendance`);
    }
    const { data: corrAudit } = await admin
      .from("audit_log")
      .select("action, metadata")
      .eq("actor_user_id", adminUser.id)
      .eq("action", "event.correct_attendance")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!corrAudit) throw new Error(`correct_attendance audit missing`);
    const meta = corrAudit.metadata as {
      action?: string;
      before?: Record<string, unknown> | null;
      after?: Record<string, unknown> | null;
    };
    if (meta.action !== "remove") {
      throw new Error(`audit action metadata: ${JSON.stringify(meta)}`);
    }
    if (!meta.before || meta.after !== null) {
      throw new Error(
        `expected before=obj after=null in audit, got ${JSON.stringify(meta)}`
      );
    }
    console.log(
      `[smoke-event-check-in] OK: correct_attendance remove deleted row + audit before/after`
    );

    console.log("[smoke-event-check-in] ALL OK");
  } finally {
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const u of [adminUser, walkin, member]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-event-check-in] FAILED:", err);
  process.exit(1);
});
