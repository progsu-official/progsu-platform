#!/usr/bin/env tsx
// Smoke: multi-surface visibility parity. For each (event, user) permutation,
// assert the same boolean across:
//   - can_view_event(event, user)
//   - presence in member_visible_events (as that user)
//   - direct SELECT from events WHERE id = X (RLS)
//   - direct SELECT from event_hosts WHERE event_id = X (RLS)
//   - storage.objects SELECT for {event_id}/cover.jpg in event-covers bucket
//
// Events seeded:
//   - draft (members visibility)
//   - published members-visibility
//   - published private-invite (userA invited, userB not)
//   - cancelled (userC had a going RSVP before cancellation)
//   - archived

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

type Perm = {
  name: string;
  eventKey: "draft" | "members" | "private" | "cancelled" | "archived";
  userKey: "admin" | "userA" | "userB" | "userC" | "userD";
  expected: boolean;
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
          last_name: "Vis",
          school: "Georgia State University",
          major: "Computer Science",
          class_standing: "junior",
          grad_year: y,
          grad_term: `Fall ${y}`,
          interested_roles: ["software_engineering"],
        })
        .eq("id", uid);
      await admin.from("resumes").insert({
        id: crypto.randomUUID(),
        user_id: uid,
        storage_path: `${uid}/smoke-vis.pdf`,
        file_name: "smoke-vis.pdf",
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
  const adminUser = await makeUser(`admin-vis-${suffix}@example.com`, {
    isAdmin: true,
    fullyOnboarded: true,
  });
  const userA = await makeUser(`userA-vis-${suffix}@example.com`, {
    fullyOnboarded: true,
  });
  const userB = await makeUser(`userB-vis-${suffix}@example.com`, {
    fullyOnboarded: true,
  });
  const userC = await makeUser(`userC-vis-${suffix}@example.com`, {
    fullyOnboarded: true,
  });
  const userD = await makeUser(`userD-vis-${suffix}@example.com`, {
    fullyOnboarded: true,
  });

  const adminClient = await userClient(adminUser.email!);
  // Use `Awaited<ReturnType<...>>` of userClient so the type reflects the
  // concrete signed-in client and stays compatible with stricter supabase-js
  // generic defaults.
  type UC = Awaited<ReturnType<typeof userClient>>;
  const clients: Record<Perm["userKey"], UC> = {
    admin: adminClient,
    userA: await userClient(userA.email!),
    userB: await userClient(userB.email!),
    userC: await userClient(userC.email!),
    userD: await userClient(userD.email!),
  };
  const userIds: Record<Perm["userKey"], string> = {
    admin: adminUser.id,
    userA: userA.id,
    userB: userB.id,
    userC: userC.id,
    userD: userD.id,
  };

  console.log(`[smoke-event-visibility] seeded admin + 4 members`);

  const created: string[] = [];
  try {
    // Helper to create an event in a given target status.
    async function seedEvent(
      slug: string,
      payload: Record<string, unknown>,
      target: "draft" | "published" | "cancelled" | "archived"
    ): Promise<string> {
      const { data: id, error: cErr } = await adminClient.rpc("create_event", {
        p_payload: {
          slug,
          title: `Visibility smoke ${slug}`,
          visibility: "members",
          capacity: null,
          waitlist_enabled: false,
          ...payload,
        },
      });
      if (cErr || typeof id !== "string") {
        throw new Error(`seedEvent ${slug}: ${cErr?.message}`);
      }
      created.push(id);

      // Always add one host so event_hosts visibility can be tested.
      await admin.from("event_hosts").insert({
        event_id: id,
        sort_order: 0,
        display_name: `${slug} host`,
      });

      // Cover image: upload a tiny placeholder to {event_id}/cover.jpg.
      const coverBuf = Buffer.from("\xFF\xD8\xFF\xDB\x00\x01JFIF", "binary");
      await admin.storage
        .from("event-covers")
        .upload(`${id}/cover.jpg`, coverBuf, {
          contentType: "image/jpeg",
          upsert: true,
        });
      await admin
        .from("events")
        .update({ cover_image_path: `${id}/cover.jpg` })
        .eq("id", id);

      if (target === "draft") return id;

      // publish_event (cancel / archive build on top of published where needed).
      const { error: pubErr } = await adminClient.rpc("publish_event", {
        p_event_id: id,
      });
      if (pubErr) throw new Error(`publish ${slug}: ${pubErr.message}`);
      if (target === "published") return id;

      if (target === "cancelled" || target === "archived") {
        const { error: canErr } = await adminClient.rpc("cancel_event", {
          p_event_id: id,
          p_reason: "smoke test",
        });
        if (canErr) throw new Error(`cancel ${slug}: ${canErr.message}`);
      }
      if (target === "archived") {
        const { error: arErr } = await adminClient.rpc("archive_event", {
          p_event_id: id,
        });
        if (arErr) throw new Error(`archive ${slug}: ${arErr.message}`);
      }
      return id;
    }

    const starts = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const ends = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString();
    const timeFields = { starts_at: starts, ends_at: ends };

    const draftId = await seedEvent(
      `vis-draft-${suffix}`,
      { ...timeFields, visibility: "members" },
      "draft"
    );
    const membersId = await seedEvent(
      `vis-members-${suffix}`,
      { ...timeFields, visibility: "members" },
      "published"
    );
    const privateId = await seedEvent(
      `vis-priv-${suffix}`,
      { ...timeFields, visibility: "private_invite" },
      "published"
    );
    const cancelledId = await seedEvent(
      `vis-cancelled-${suffix}`,
      { ...timeFields, visibility: "members" },
      "published"
    );
    const archivedId = await seedEvent(
      `vis-archived-${suffix}`,
      { ...timeFields, visibility: "members" },
      "published"
    );

    // Invite userA to the private event.
    await adminClient.rpc("invite_member_to_event", {
      p_event_id: privateId,
      p_user_id: userA.id,
    });

    // Give userC a going RSVP on the (soon-to-be) cancelled event.
    const userCClient = clients.userC;
    const { error: rsvpErr } = await userCClient.rpc("rsvp_to_event", {
      p_event_id: cancelledId,
      p_desired: "going",
    });
    if (rsvpErr) throw new Error(`userC rsvp cancelled: ${rsvpErr.message}`);

    // Cancel the event after RSVP recorded.
    await adminClient.rpc("cancel_event", {
      p_event_id: cancelledId,
      p_reason: "smoke cancel",
    });

    // Archive the archived event (it was seeded as published; now archive it).
    await adminClient.rpc("archive_event", { p_event_id: archivedId });

    const eventIds: Record<Perm["eventKey"], string> = {
      draft: draftId,
      members: membersId,
      private: privateId,
      cancelled: cancelledId,
      archived: archivedId,
    };

    console.log(
      `[smoke-event-visibility] seeded 5 events (draft/members/private/cancelled/archived)`
    );

    // Expectations per can_view_event logic in migration 3:
    //   admin → always true
    //   draft/archived → only admin
    //   cancelled → admin OR (RSVP/waitlist OR attendance)
    //   members → admin OR any authenticated user
    //   private_invite → admin OR active invite
    const perms: Perm[] = [
      // Draft: admin only.
      { name: "admin→draft",       eventKey: "draft",     userKey: "admin", expected: true  },
      { name: "userA→draft",       eventKey: "draft",     userKey: "userA", expected: false },
      { name: "userB→draft",       eventKey: "draft",     userKey: "userB", expected: false },

      // Members: everyone.
      { name: "admin→members",     eventKey: "members",   userKey: "admin", expected: true  },
      { name: "userA→members",     eventKey: "members",   userKey: "userA", expected: true  },
      { name: "userB→members",     eventKey: "members",   userKey: "userB", expected: true  },
      { name: "userD→members",     eventKey: "members",   userKey: "userD", expected: true  },

      // Private invite: admin + userA (invitee), not userB.
      { name: "admin→private",     eventKey: "private",   userKey: "admin", expected: true  },
      { name: "userA→private",     eventKey: "private",   userKey: "userA", expected: true  },
      { name: "userB→private",     eventKey: "private",   userKey: "userB", expected: false },

      // Cancelled: admin + userC (had RSVP), not userB.
      { name: "admin→cancelled",   eventKey: "cancelled", userKey: "admin", expected: true  },
      { name: "userC→cancelled",   eventKey: "cancelled", userKey: "userC", expected: true  },
      { name: "userB→cancelled",   eventKey: "cancelled", userKey: "userB", expected: false },

      // Archived: admin only.
      { name: "admin→archived",    eventKey: "archived",  userKey: "admin", expected: true  },
      { name: "userA→archived",    eventKey: "archived",  userKey: "userA", expected: false },
    ];

    // --- can_view_event ------------------------------------------------------
    for (const p of perms) {
      const eid = eventIds[p.eventKey];
      const uid = userIds[p.userKey];
      const { data: rpcBool, error: rpcErr } = await admin.rpc("can_view_event", {
        p_event_id: eid,
        p_user_id: uid,
      });
      if (rpcErr) throw new Error(`can_view_event ${p.name}: ${rpcErr.message}`);
      if (rpcBool !== p.expected) {
        throw new Error(
          `can_view_event ${p.name}: got ${rpcBool}, expected ${p.expected}`
        );
      }
    }
    console.log(
      `[smoke-event-visibility] OK: can_view_event agrees with expected matrix (${perms.length} perms)`
    );

    // --- member_visible_events view (authenticated caller) -------------------
    // Discovery feed: published + (members OR live invite). Draft/cancelled/
    // archived are never in this view regardless of user (D6).
    for (const p of perms) {
      const eid = eventIds[p.eventKey];
      const client = clients[p.userKey];
      const { data: rows, error: viewErr } = await client
        .from("member_visible_events")
        .select("id")
        .eq("id", eid);
      if (viewErr) {
        throw new Error(
          `member_visible_events ${p.name}: ${viewErr.message}`
        );
      }
      const seen = (rows ?? []).length > 0;
      // View only surfaces published+members or published+private(invited).
      // It intentionally excludes admin's view of draft/cancelled/archived.
      const expectedInView =
        p.eventKey === "members"
          ? true
          : p.eventKey === "private"
            ? p.userKey === "userA" // only the active invitee
            : false; // draft/cancelled/archived never here
      if (seen !== expectedInView) {
        throw new Error(
          `member_visible_events ${p.name}: seen=${seen}, expected=${expectedInView}`
        );
      }
    }
    console.log(
      `[smoke-event-visibility] OK: member_visible_events matches expected discovery feed`
    );

    // --- direct SELECT from events via user-context client (RLS) -------------
    for (const p of perms) {
      const eid = eventIds[p.eventKey];
      const client = clients[p.userKey];
      const { data: row, error: readErr } = await client
        .from("events")
        .select("id")
        .eq("id", eid)
        .maybeSingle();
      if (readErr && readErr.code !== "PGRST116") {
        throw new Error(
          `events RLS read ${p.name}: ${readErr.code} ${readErr.message}`
        );
      }
      const seen = !!row;
      if (seen !== p.expected) {
        throw new Error(
          `events direct SELECT ${p.name}: seen=${seen}, expected=${p.expected}`
        );
      }
    }
    console.log(
      `[smoke-event-visibility] OK: events RLS matches can_view_event`
    );

    // --- direct SELECT from event_hosts via user-context client --------------
    for (const p of perms) {
      const eid = eventIds[p.eventKey];
      const client = clients[p.userKey];
      const { data: rows, error: readErr } = await client
        .from("event_hosts")
        .select("event_id")
        .eq("event_id", eid);
      if (readErr) {
        throw new Error(
          `event_hosts RLS read ${p.name}: ${readErr.code} ${readErr.message}`
        );
      }
      const seen = (rows ?? []).length > 0;
      if (seen !== p.expected) {
        throw new Error(
          `event_hosts direct SELECT ${p.name}: seen=${seen}, expected=${p.expected}`
        );
      }
    }
    console.log(
      `[smoke-event-visibility] OK: event_hosts RLS matches can_view_event`
    );

    // --- storage: event-covers bucket ----------------------------------------
    // Test storage.objects SELECT via user-context client download.
    for (const p of perms) {
      const eid = eventIds[p.eventKey];
      const client = clients[p.userKey];
      const { data: blob, error: dlErr } = await client.storage
        .from("event-covers")
        .download(`${eid}/cover.jpg`);
      // When policy denies, supabase-storage returns an error (404 / not found
      // / 400). When it allows, blob is defined.
      const allowed = !dlErr && !!blob;
      if (allowed !== p.expected) {
        throw new Error(
          `event-covers download ${p.name}: allowed=${allowed}, expected=${p.expected} (err=${dlErr?.message})`
        );
      }
    }
    console.log(
      `[smoke-event-visibility] OK: event-covers storage matches can_view_event`
    );

    console.log("[smoke-event-visibility] ALL OK");
  } finally {
    // Remove storage objects for each created event.
    for (const id of created) {
      const { data: objs } = await admin.storage
        .from("event-covers")
        .list(id);
      if (objs && objs.length > 0) {
        await admin.storage
          .from("event-covers")
          .remove(objs.map((o) => `${id}/${o.name}`));
      }
    }
    for (const id of created) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const u of [adminUser, userA, userB, userC, userD]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-event-visibility] FAILED:", err);
  process.exit(1);
});
