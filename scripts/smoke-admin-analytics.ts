#!/usr/bin/env tsx
// Smoke: admin analytics RPCs — per-event + cross-event rollup.
// Seeds two events with mixed RSVPs, attendances, and notification jobs,
// then asserts the RPC output matches what was seeded.

import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data: versionRows } = await admin
    .from("consent_versions")
    .select("consent_type, version");
  const currentVersions = new Map<string, string>(
    (versionRows ?? []).map((r) => [r.consent_type as string, r.version as string])
  );

  const suffix = Date.now();
  const password = "analytics-smoke-1234";
  const createdUsers: string[] = [];
  const createdEvents: string[] = [];

  async function seedUser(label: string, isAdmin = false): Promise<string> {
    const email = `${label}-${suffix}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
    const uid = data.user.id;
    createdUsers.push(uid);

    await admin
      .from("profiles")
      .update({
        first_name: label,
        last_name: "Smoke",
        school: "Georgia State University",
        major: "CS",
        class_standing: "junior",
        grad_year: 2027,
        grad_term: "Spring 2027",
        interested_roles: ["software_engineering"],
        phone_number: "555-555-5555",
        is_admin: isAdmin,
      })
      .eq("id", uid);
    for (const [t, v] of currentVersions) {
      await admin.from("consents").insert({
        user_id: uid,
        consent_type: t,
        accepted: true,
        version: v,
      });
    }
    await admin.from("resumes").insert({
      user_id: uid,
      storage_path: `${uid}/resume-${suffix}.pdf`,
      file_name: "r.pdf",
      file_size: 1024,
      mime_type: "application/pdf",
      status: "active",
      is_current: true,
    });
    return uid;
  }

  async function seedEvent(
    slug: string,
    opts: { startsAgoHours?: number; capacity?: number | null } = {}
  ): Promise<string> {
    const id = randomUUID();
    const startsAgoHours = opts.startsAgoHours ?? 4;
    const starts = new Date(Date.now() - startsAgoHours * 60 * 60 * 1000);
    const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
    await admin.from("events").insert({
      id,
      slug: `${slug}-${suffix}`,
      title: `${slug} smoke`,
      status: "published",
      visibility: "members",
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      capacity: opts.capacity ?? null,
      published_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    createdEvents.push(id);
    return id;
  }

  try {
    const adminId = await seedUser("admin", true);
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    const carol = await seedUser("carol");

    // Event 1: 2 going, 1 attended (alice) → 1 no-show (bob)
    const e1 = await seedEvent("past-one");
    await admin.from("event_rsvps").insert([
      { event_id: e1, user_id: alice, status: "going" },
      { event_id: e1, user_id: bob, status: "going" },
    ]);
    await admin.from("event_attendances").insert({
      event_id: e1,
      user_id: alice,
      method: "self_code",
      checked_in_by: alice,
    });

    // Event 2: 1 walk-in (carol), no RSVP row
    const e2 = await seedEvent("past-two");
    await admin.from("event_attendances").insert({
      event_id: e2,
      user_id: carol,
      method: "admin_click",
      checked_in_by: adminId,
    });

    const adminClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
    await adminClient.auth.signInWithPassword({
      email: `admin-${suffix}@example.com`,
      password,
    });

    const { data: d1, error: err1 } = await adminClient.rpc(
      "admin_event_analytics_for",
      { p_event_id: e1 }
    );
    if (err1) throw new Error(`per-event e1: ${err1.message}`);
    const a1 = d1 as Record<string, Record<string, unknown>>;
    if ((a1.rsvp as { going: number }).going !== 2) {
      throw new Error(`e1 going expected 2, got ${(a1.rsvp as { going: number }).going}`);
    }
    if ((a1.attendance as { total: number }).total !== 1) {
      throw new Error(`e1 attended expected 1, got ${(a1.attendance as { total: number }).total}`);
    }
    if ((a1.attendance as { no_shows: number }).no_shows !== 1) {
      throw new Error(`e1 no_shows expected 1, got ${(a1.attendance as { no_shows: number }).no_shows}`);
    }
    if ((a1.attendance as { walk_ins: number }).walk_ins !== 0) {
      throw new Error(`e1 walk_ins expected 0, got ${(a1.attendance as { walk_ins: number }).walk_ins}`);
    }
    console.log(`[smoke-admin-analytics] OK: event 1 numbers match (2 going, 1 attended, 1 no-show)`);

    const { data: d2, error: err2 } = await adminClient.rpc(
      "admin_event_analytics_for",
      { p_event_id: e2 }
    );
    if (err2) throw new Error(`per-event e2: ${err2.message}`);
    const a2 = d2 as Record<string, Record<string, unknown>>;
    if ((a2.attendance as { walk_ins: number }).walk_ins !== 1) {
      throw new Error(`e2 walk_ins expected 1, got ${(a2.attendance as { walk_ins: number }).walk_ins}`);
    }
    if ((a2.attendance as { admin_click: number }).admin_click !== 1) {
      throw new Error(`e2 admin_click expected 1, got ${(a2.attendance as { admin_click: number }).admin_click}`);
    }
    console.log(`[smoke-admin-analytics] OK: event 2 numbers match (1 walk-in, admin_click)`);

    const { data: cross, error: crossErr } = await adminClient.rpc(
      "admin_cross_event_analytics",
      { p_window_days: 7 }
    );
    if (crossErr) throw new Error(`cross-event: ${crossErr.message}`);
    const c = cross as Record<string, unknown>;
    const eventsRun = c.events_run as number;
    const totalGoing = c.total_going as number;
    const totalCheckin = c.total_checkin as number;
    if (eventsRun < 2) {
      throw new Error(`cross eventsRun expected >= 2, got ${eventsRun}`);
    }
    if (totalGoing < 2) {
      throw new Error(`cross totalGoing expected >= 2, got ${totalGoing}`);
    }
    if (totalCheckin < 2) {
      throw new Error(`cross totalCheckin expected >= 2, got ${totalCheckin}`);
    }
    console.log(
      `[smoke-admin-analytics] OK: cross-event rollup includes seeded data (${eventsRun} events, ${totalGoing} going, ${totalCheckin} check-ins)`
    );

    const member = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
    await member.auth.signInWithPassword({
      email: `alice-${suffix}@example.com`,
      password,
    });
    const { error: denyErr } = await member.rpc("admin_event_analytics_for", {
      p_event_id: e1,
    });
    if (!denyErr) throw new Error(`non-admin should be rejected`);
    if (denyErr.code !== "P0001") {
      throw new Error(`expected P0001, got ${denyErr.code}`);
    }
    console.log(`[smoke-admin-analytics] OK: non-admin blocked with P0001`);

    console.log("[smoke-admin-analytics] ALL OK");
  } finally {
    for (const id of createdEvents) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const uid of createdUsers) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-admin-analytics] FAILED:", err);
  process.exit(1);
});
