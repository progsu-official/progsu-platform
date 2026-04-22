#!/usr/bin/env tsx
// Smoke: admin CRUD + lifecycle on events via create_event/update_event/
// publish_event/cancel_event/archive_event. Non-admin callers must be denied.
// Slug uniqueness enforced. Time order enforced. Audit rows written.

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

  async function makeUser(email: string, isAdmin: boolean) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "testpassword-12345",
      email_confirm: true,
      user_metadata: { given_name: email.split("@")[0], family_name: "Tester" },
    });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
    if (isAdmin) {
      const { error: upErr } = await admin
        .from("profiles")
        .update({ is_admin: true })
        .eq("id", data.user.id);
      if (upErr) throw new Error(`promote ${email}: ${upErr.message}`);
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
  const adminEmail = `admin-ecrud-${suffix}@example.com`;
  const memberEmail = `member-ecrud-${suffix}@example.com`;
  const adminUser = await makeUser(adminEmail, true);
  const memberUser = await makeUser(memberEmail, false);
  const adminClient = await userClient(adminEmail);
  const memberClient = await userClient(memberEmail);
  console.log(
    `[smoke-event-crud] seeded admin=${adminUser.id} member=${memberUser.id}`
  );

  const createdEventIds: string[] = [];
  try {
    const starts = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const ends = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString();
    const baseSlug = `ecrud-${suffix}`;

    // 1. Admin creates draft via create_event.
    const { data: createdId, error: createErr } = await adminClient.rpc(
      "create_event",
      {
        p_payload: {
          slug: baseSlug,
          title: "Release 1 Smoke Event",
          description_md: "Initial draft.",
          visibility: "members",
          starts_at: starts,
          ends_at: ends,
          location_text: "Student Center Room 101",
          capacity: 10,
          waitlist_enabled: true,
          send_rsvp_email: true,
          send_reminder_email: true,
          hosts: [
            { display_name: "Progsu Board", sort_order: 0 },
            { display_name: "Org Committee", sort_order: 1 },
          ],
        },
      }
    );
    if (createErr || typeof createdId !== "string") {
      throw new Error(`admin create_event: ${createErr?.message}`);
    }
    const eventId = createdId;
    createdEventIds.push(eventId);
    console.log(`[smoke-event-crud] OK: admin create_event returned id=${eventId}`);

    // Verify row + hosts were inserted via admin read.
    const { data: row, error: readErr } = await admin
      .from("events")
      .select("id, slug, status, created_by, updated_by, capacity")
      .eq("id", eventId)
      .single();
    if (readErr || !row) throw new Error(`read after create: ${readErr?.message}`);
    if (row.status !== "draft") throw new Error(`expected draft, got ${row.status}`);
    if (row.slug !== baseSlug) throw new Error(`slug mismatch: ${row.slug}`);
    if (row.created_by !== adminUser.id) {
      throw new Error(`created_by mismatch: ${row.created_by}`);
    }
    console.log(`[smoke-event-crud] OK: created row persisted as draft`);

    const { data: hosts } = await admin
      .from("event_hosts")
      .select("sort_order, display_name")
      .eq("event_id", eventId)
      .order("sort_order");
    if (!hosts || hosts.length !== 2) {
      throw new Error(`expected 2 hosts, got ${hosts?.length}`);
    }
    console.log(`[smoke-event-crud] OK: 2 event_hosts rows written`);

    // 2. Non-admin calling create_event → P0001.
    const { error: memberCreateErr } = await memberClient.rpc("create_event", {
      p_payload: {
        slug: `${baseSlug}-member`,
        title: "Should be blocked",
        starts_at: starts,
        ends_at: ends,
      },
    });
    if (!memberCreateErr) throw new Error("member create_event should fail");
    if (memberCreateErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on member create, got ${memberCreateErr.code}: ${memberCreateErr.message}`
      );
    }
    console.log(`[smoke-event-crud] OK: non-admin create_event → P0001`);

    // 3. Slug uniqueness enforced.
    const { error: dupErr } = await adminClient.rpc("create_event", {
      p_payload: {
        slug: baseSlug,
        title: "Duplicate slug",
        starts_at: starts,
        ends_at: ends,
      },
    });
    if (!dupErr) throw new Error("duplicate slug should have failed");
    // Postgres unique violation = 23505.
    if (dupErr.code !== "23505") {
      throw new Error(
        `expected 23505 unique_violation, got ${dupErr.code}: ${dupErr.message}`
      );
    }
    console.log(`[smoke-event-crud] OK: duplicate slug rejected (23505)`);

    // 4. ends_at < starts_at rejected by events_time_order.
    const { error: timeErr } = await adminClient.rpc("create_event", {
      p_payload: {
        slug: `${baseSlug}-backwards`,
        title: "Backwards",
        starts_at: ends,
        ends_at: starts,
      },
    });
    if (!timeErr) throw new Error("backwards time range should have failed");
    if (timeErr.code !== "23514") {
      throw new Error(
        `expected 23514 check_violation, got ${timeErr.code}: ${timeErr.message}`
      );
    }
    console.log(`[smoke-event-crud] OK: ends_at < starts_at rejected (23514)`);

    // 5. Admin updates title + capacity via update_event.
    const { error: updErr } = await adminClient.rpc("update_event", {
      p_event_id: eventId,
      p_patch: {
        title: "Release 1 Smoke Event (Updated)",
        capacity: 20,
        location_text: "Student Center Room 202",
      },
    });
    if (updErr) throw new Error(`admin update_event: ${updErr.message}`);
    const { data: afterUpd } = await admin
      .from("events")
      .select("title, capacity, location_text, updated_by")
      .eq("id", eventId)
      .single();
    if (afterUpd?.title !== "Release 1 Smoke Event (Updated)") {
      throw new Error(`title not updated: ${afterUpd?.title}`);
    }
    if (afterUpd?.capacity !== 20) {
      throw new Error(`capacity not updated: ${afterUpd?.capacity}`);
    }
    if (afterUpd?.updated_by !== adminUser.id) {
      throw new Error(`updated_by mismatch: ${afterUpd?.updated_by}`);
    }
    console.log(`[smoke-event-crud] OK: admin update_event applied patch`);

    // 6. Non-admin update_event → P0001.
    const { error: memberUpdErr } = await memberClient.rpc("update_event", {
      p_event_id: eventId,
      p_patch: { title: "Haxxor" },
    });
    if (!memberUpdErr) throw new Error("member update_event should fail");
    if (memberUpdErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on member update, got ${memberUpdErr.code}: ${memberUpdErr.message}`
      );
    }
    console.log(`[smoke-event-crud] OK: non-admin update_event → P0001`);

    // 7. update_event rejects status key (lifecycle helpers only).
    const { error: statusKeyErr } = await adminClient.rpc("update_event", {
      p_event_id: eventId,
      p_patch: { status: "published" },
    });
    if (!statusKeyErr) throw new Error("status key should be rejected");
    if (statusKeyErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on status patch, got ${statusKeyErr.code}: ${statusKeyErr.message}`
      );
    }
    console.log(
      `[smoke-event-crud] OK: update_event refuses status key (P0001)`
    );

    // 8. Admin publish_event.
    const { error: pubErr } = await adminClient.rpc("publish_event", {
      p_event_id: eventId,
    });
    if (pubErr) throw new Error(`publish_event: ${pubErr.message}`);
    const { data: afterPub } = await admin
      .from("events")
      .select("status, published_at")
      .eq("id", eventId)
      .single();
    if (afterPub?.status !== "published") {
      throw new Error(`status after publish: ${afterPub?.status}`);
    }
    if (!afterPub?.published_at) {
      throw new Error(`published_at not set`);
    }
    console.log(`[smoke-event-crud] OK: publish_event draft → published`);

    // 9. Non-admin publish_event → P0001.
    const { error: memberPubErr } = await memberClient.rpc("publish_event", {
      p_event_id: eventId,
    });
    if (!memberPubErr || memberPubErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on member publish, got ${memberPubErr?.code}`
      );
    }
    console.log(`[smoke-event-crud] OK: non-admin publish_event → P0001`);

    // 10. Admin cancel_event with reason.
    const { error: canErr } = await adminClient.rpc("cancel_event", {
      p_event_id: eventId,
      p_reason: "Venue lost power (smoke test)",
    });
    if (canErr) throw new Error(`cancel_event: ${canErr.message}`);
    const { data: afterCan } = await admin
      .from("events")
      .select("status, cancelled_at, cancellation_reason")
      .eq("id", eventId)
      .single();
    if (afterCan?.status !== "cancelled") {
      throw new Error(`status after cancel: ${afterCan?.status}`);
    }
    if (!afterCan?.cancelled_at) {
      throw new Error(`cancelled_at not set`);
    }
    if (afterCan?.cancellation_reason !== "Venue lost power (smoke test)") {
      throw new Error(`reason mismatch: ${afterCan?.cancellation_reason}`);
    }
    console.log(`[smoke-event-crud] OK: cancel_event set status + reason`);

    // 11. Non-admin cancel_event → P0001.
    const { error: memberCanErr } = await memberClient.rpc("cancel_event", {
      p_event_id: eventId,
      p_reason: "nope",
    });
    if (!memberCanErr || memberCanErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on member cancel, got ${memberCanErr?.code}`
      );
    }
    console.log(`[smoke-event-crud] OK: non-admin cancel_event → P0001`);

    // 12. Admin archive_event (cancelled → archived).
    const { error: archErr } = await adminClient.rpc("archive_event", {
      p_event_id: eventId,
    });
    if (archErr) throw new Error(`archive_event: ${archErr.message}`);
    const { data: afterArch } = await admin
      .from("events")
      .select("status, archived_at")
      .eq("id", eventId)
      .single();
    if (afterArch?.status !== "archived") {
      throw new Error(`status after archive: ${afterArch?.status}`);
    }
    if (!afterArch?.archived_at) {
      throw new Error(`archived_at not set`);
    }
    console.log(`[smoke-event-crud] OK: archive_event cancelled → archived`);

    // 13. Non-admin archive_event → P0001.
    const { error: memberArchErr } = await memberClient.rpc("archive_event", {
      p_event_id: eventId,
    });
    if (!memberArchErr || memberArchErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on member archive, got ${memberArchErr?.code}`
      );
    }
    console.log(`[smoke-event-crud] OK: non-admin archive_event → P0001`);

    // 14. Audit trail: expect one row each for create/update/publish/cancel/archive.
    const { data: auditRows, error: auditErr } = await admin
      .from("audit_log")
      .select("action, metadata")
      .eq("actor_user_id", adminUser.id)
      .in("action", [
        "event.create",
        "event.update",
        "event.publish",
        "event.cancel",
        "event.archive",
      ])
      .order("created_at", { ascending: true });
    if (auditErr) throw new Error(`audit read: ${auditErr.message}`);
    const actions = (auditRows ?? []).map((r) => r.action);
    const expected = [
      "event.create",
      "event.update",
      "event.publish",
      "event.cancel",
      "event.archive",
    ];
    for (const e of expected) {
      if (!actions.includes(e)) {
        throw new Error(`audit missing ${e}: got ${actions.join(",")}`);
      }
    }
    const createAudit = (auditRows ?? []).find((r) => r.action === "event.create");
    if (
      !createAudit ||
      (createAudit.metadata as { event_id?: string }).event_id !== eventId
    ) {
      throw new Error(`event.create audit metadata missing event_id`);
    }
    console.log(
      `[smoke-event-crud] OK: audit_log has create/update/publish/cancel/archive`
    );

    console.log("[smoke-event-crud] ALL OK");
  } finally {
    // Cleanup: hard-delete any events created (archived ones too — service role
    // bypasses RLS and cascades hosts/invites/rsvps/attendances via their FKs).
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    await admin.auth.admin.deleteUser(adminUser.id).catch(() => {});
    await admin.auth.admin.deleteUser(memberUser.id).catch(() => {});
  }
}

main().catch((err) => {
  console.error("[smoke-event-crud] FAILED:", err);
  process.exit(1);
});
