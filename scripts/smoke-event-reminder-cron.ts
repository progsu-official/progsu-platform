#!/usr/bin/env tsx
// Smoke: reminder cron fan-out. Seed a published event with send_reminder_email
// and reminder_sent_at = null. Enqueue per-RSVP jobs via enqueue_event_notification.
// Simulate the worker using service-role: claim, mark sent, mark_event_reminder_sent.
// Verify jobs are 'sent', event.reminder_sent_at is set, re-claim yields 0 jobs,
// and authenticated (non-service) callers cannot claim.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  // Service-role client (bypasses RLS, auth.role() = 'service_role').
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

  async function makeUser(
    email: string,
    opts: { isAdmin?: boolean; fullyOnboarded?: boolean } = {}
  ) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: email.split("@")[0] },
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
          last_name: "Cron",
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
        storage_path: `${uid}/smoke-cron.pdf`,
        file_name: "smoke-cron.pdf",
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
  const adminUser = await makeUser(`admin-cron-${suffix}@example.com`, {
    isAdmin: true,
    fullyOnboarded: true,
  });
  const user1 = await makeUser(`u1-cron-${suffix}@example.com`, {
    fullyOnboarded: true,
  });
  const user2 = await makeUser(`u2-cron-${suffix}@example.com`, {
    fullyOnboarded: true,
  });
  const user3 = await makeUser(`u3-cron-${suffix}@example.com`, {
    fullyOnboarded: true,
  });

  const adminClient = await userClient(adminUser.email!);
  const u1Client = await userClient(user1.email!);
  const u2Client = await userClient(user2.email!);
  const u3Client = await userClient(user3.email!);

  console.log(
    `[smoke-event-reminder-cron] seeded admin + 3 onboarded members`
  );

  const createdEventIds: string[] = [];
  const allJobIds: string[] = [];
  try {
    // starts_at 25 hours from now (within typical reminder lookahead).
    const starts = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    const ends = new Date(Date.now() + 27 * 60 * 60 * 1000).toISOString();

    const { data: evId, error: cErr } = await adminClient.rpc("create_event", {
      p_payload: {
        slug: `cron-smoke-${suffix}`,
        title: "Reminder Cron Smoke",
        visibility: "members",
        starts_at: starts,
        ends_at: ends,
        capacity: null,
        waitlist_enabled: false,
        send_reminder_email: true,
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
    if (pubErr) throw new Error(`publish: ${pubErr.message}`);

    // Confirm reminder_sent_at is null.
    const { data: evRowBefore } = await admin
      .from("events")
      .select("send_reminder_email, reminder_sent_at")
      .eq("id", eventId)
      .single();
    if (!evRowBefore?.send_reminder_email) {
      throw new Error(`send_reminder_email should be true`);
    }
    if (evRowBefore?.reminder_sent_at !== null) {
      throw new Error(
        `reminder_sent_at expected null, got ${evRowBefore?.reminder_sent_at}`
      );
    }
    console.log(
      `[smoke-event-reminder-cron] OK: event seeded (reminders on, unsent, starts in 25h)`
    );

    // All three RSVP 'going'.
    for (const [label, client] of [
      ["user1", u1Client],
      ["user2", u2Client],
      ["user3", u3Client],
    ] as const) {
      const { data: eff, error: rErr } = await client.rpc("rsvp_to_event", {
        p_event_id: eventId,
        p_desired: "going",
      });
      if (rErr) throw new Error(`${label} rsvp: ${rErr.message}`);
      if (eff !== "going") throw new Error(`${label} effective ${eff}`);
    }
    console.log(`[smoke-event-reminder-cron] OK: 3 going RSVPs recorded`);

    // Enqueue reminder jobs for each going RSVP. Use service-role for enqueue
    // (admin client is service-role).
    const { data: rsvps } = await admin
      .from("event_rsvps")
      .select("user_id")
      .eq("event_id", eventId)
      .eq("status", "going");
    if (!rsvps || rsvps.length !== 3) {
      throw new Error(`expected 3 going rsvps, got ${rsvps?.length}`);
    }
    const scheduledFor = new Date(Date.now() - 60_000).toISOString(); // due already
    const dedupeKey = `reminder:${eventId}`;
    for (const r of rsvps) {
      const { data: jobId, error: enqErr } = await admin.rpc(
        "enqueue_event_notification",
        {
          p_event_id: eventId,
          p_kind: "reminder",
          p_user_id: r.user_id,
          p_scheduled_for: scheduledFor,
          p_dedupe_key: dedupeKey,
        }
      );
      if (enqErr || typeof jobId !== "string") {
        throw new Error(`enqueue: ${enqErr?.message}`);
      }
      allJobIds.push(jobId);
    }
    console.log(
      `[smoke-event-reminder-cron] OK: enqueued 3 reminder jobs`
    );

    // 1. Authenticated caller must NOT be able to call claim_event_notification_jobs.
    const { error: authClaimErr } = await adminClient.rpc(
      "claim_event_notification_jobs",
      { p_limit: 100 }
    );
    if (!authClaimErr) {
      throw new Error(
        `authenticated claim_event_notification_jobs should fail`
      );
    }
    // P0001 raise_exception OR 42501 insufficient_privilege (grant removed from
    // authenticated). Both are acceptable.
    if (authClaimErr.code !== "P0001" && authClaimErr.code !== "42501") {
      throw new Error(
        `expected P0001 or 42501 from auth claim, got ${authClaimErr.code}: ${authClaimErr.message}`
      );
    }
    console.log(
      `[smoke-event-reminder-cron] OK: authenticated claim denied (${authClaimErr.code})`
    );

    // 2. Service-role claim — should return 3 jobs, mark them in_flight.
    const { data: claimed, error: claimErr } = await admin.rpc(
      "claim_event_notification_jobs",
      { p_limit: 100 }
    );
    if (claimErr) throw new Error(`service claim: ${claimErr.message}`);
    if (!Array.isArray(claimed) || claimed.length !== 3) {
      throw new Error(
        `expected 3 claimed jobs, got ${Array.isArray(claimed) ? claimed.length : "non-array"}`
      );
    }
    for (const j of claimed) {
      const row = j as { id: string; status: string; attempts: number };
      if (row.status !== "in_flight") {
        throw new Error(
          `claimed job ${row.id} status: ${row.status}, expected in_flight`
        );
      }
      if (row.attempts !== 1) {
        throw new Error(
          `claimed job ${row.id} attempts: ${row.attempts}, expected 1`
        );
      }
    }
    console.log(
      `[smoke-event-reminder-cron] OK: claim_event_notification_jobs returned 3 in_flight jobs`
    );

    // 3. Finish each job as 'sent'.
    for (const j of claimed) {
      const row = j as { id: string };
      const { error: finErr } = await admin.rpc(
        "finish_event_notification_job",
        { p_id: row.id, p_status: "sent" }
      );
      if (finErr) throw new Error(`finish ${row.id}: ${finErr.message}`);
    }
    const { data: finishedJobs } = await admin
      .from("event_notification_jobs")
      .select("id, status, sent_at")
      .in("id", allJobIds);
    if (!finishedJobs || finishedJobs.length !== 3) {
      throw new Error(
        `expected 3 finished jobs, got ${finishedJobs?.length}`
      );
    }
    for (const fj of finishedJobs) {
      if (fj.status !== "sent") {
        throw new Error(`job ${fj.id} status: ${fj.status}`);
      }
      if (!fj.sent_at) {
        throw new Error(`job ${fj.id} sent_at not populated`);
      }
    }
    console.log(
      `[smoke-event-reminder-cron] OK: all jobs status=sent with sent_at set`
    );

    // 4. mark_event_reminder_sent sets events.reminder_sent_at.
    const { error: markErr } = await admin.rpc("mark_event_reminder_sent", {
      p_event_id: eventId,
    });
    if (markErr) throw new Error(`mark_event_reminder_sent: ${markErr.message}`);
    const { data: evRowAfter } = await admin
      .from("events")
      .select("reminder_sent_at")
      .eq("id", eventId)
      .single();
    if (!evRowAfter?.reminder_sent_at) {
      throw new Error(
        `events.reminder_sent_at not set after mark_event_reminder_sent`
      );
    }
    console.log(
      `[smoke-event-reminder-cron] OK: events.reminder_sent_at populated`
    );

    // 5. Authenticated mark_event_reminder_sent must also fail (service_role only).
    const { error: authMarkErr } = await adminClient.rpc(
      "mark_event_reminder_sent",
      { p_event_id: eventId }
    );
    if (!authMarkErr) {
      throw new Error(
        `authenticated mark_event_reminder_sent should fail`
      );
    }
    if (authMarkErr.code !== "P0001" && authMarkErr.code !== "42501") {
      throw new Error(
        `expected P0001/42501 on auth mark, got ${authMarkErr.code}: ${authMarkErr.message}`
      );
    }
    console.log(
      `[smoke-event-reminder-cron] OK: authenticated mark_event_reminder_sent denied (${authMarkErr.code})`
    );

    // 6. Re-claim yields 0 jobs (all are 'sent' now).
    const { data: reclaim, error: reclaimErr } = await admin.rpc(
      "claim_event_notification_jobs",
      { p_limit: 100 }
    );
    if (reclaimErr) throw new Error(`reclaim: ${reclaimErr.message}`);
    if (!Array.isArray(reclaim) || reclaim.length !== 0) {
      throw new Error(
        `expected 0 reclaimed jobs, got ${Array.isArray(reclaim) ? reclaim.length : "non-array"}`
      );
    }
    console.log(
      `[smoke-event-reminder-cron] OK: re-claim returns 0 pending jobs`
    );

    // 7. Authenticated enqueue as admin succeeds (admin allowed). Non-admin
    //    authenticated fails.
    const nonAdminUser = user1;
    const nonAdminClient = u1Client;
    const { error: nonAdminEnqErr } = await nonAdminClient.rpc(
      "enqueue_event_notification",
      {
        p_event_id: eventId,
        p_kind: "reminder",
        p_user_id: nonAdminUser.id,
        p_scheduled_for: new Date().toISOString(),
        p_dedupe_key: `non-admin-${suffix}`,
      }
    );
    if (!nonAdminEnqErr) {
      throw new Error(`non-admin enqueue should fail`);
    }
    if (nonAdminEnqErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on non-admin enqueue, got ${nonAdminEnqErr.code}`
      );
    }
    console.log(
      `[smoke-event-reminder-cron] OK: non-admin enqueue_event_notification → P0001`
    );

    console.log("[smoke-event-reminder-cron] ALL OK");
  } finally {
    // Cleanup: events cascade notification_jobs + rsvps.
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    // Belt-and-suspenders: also delete any lingering jobs by id.
    if (allJobIds.length > 0) {
      await admin
        .from("event_notification_jobs")
        .delete()
        .in("id", allJobIds);
    }
    for (const u of [adminUser, user1, user2, user3]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-event-reminder-cron] FAILED:", err);
  process.exit(1);
});
