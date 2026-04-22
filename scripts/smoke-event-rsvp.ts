#!/usr/bin/env tsx
// Smoke: rsvp_to_event capacity/waitlist semantics, direct-insert denial,
// not-fully-onboarded guard, admin promote_waitlisted_member, and
// private-invite visibility on rsvp_to_event.

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
      // Profile fields.
      await admin
        .from("profiles")
        .update({
          first_name: email.split("@")[0],
          last_name: "Onboarded",
          school: "Georgia State University",
          major: "Computer Science",
          class_standing: "junior",
          grad_year: y,
          grad_term: `Fall ${y}`,
          interested_roles: ["software_engineering"],
        })
        .eq("id", uid);

      // Active current resume (just a DB row; no storage object needed for these
      // RPC checks because is_fully_onboarded() only reads resumes table).
      await admin.from("resumes").insert({
        id: crypto.randomUUID(),
        user_id: uid,
        storage_path: `${uid}/smoke-rsvp.pdf`,
        file_name: "smoke-rsvp.pdf",
        file_size: 9,
        mime_type: "application/pdf",
        status: "active",
        is_current: true,
      });

      // Required consents at the current consent_versions — fetched once
      // inside main() and passed via closure so we don't hardcode 'v1'
      // (privacy_policy bumped to v2 in migration 000200 for R2).
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
  const adminEmail = `admin-rsvp-${suffix}@example.com`;
  const aliceEmail = `alice-rsvp-${suffix}@example.com`;
  const bobEmail = `bob-rsvp-${suffix}@example.com`;
  const carolEmail = `carol-rsvp-${suffix}@example.com`;
  const davidEmail = `david-rsvp-${suffix}@example.com`;
  const erinEmail = `erin-rsvp-${suffix}@example.com`; // not onboarded
  const frankEmail = `frank-rsvp-${suffix}@example.com`; // private invitee

  const adminUser = await makeUser(adminEmail, { isAdmin: true });
  const alice = await makeUser(aliceEmail, { fullyOnboarded: true });
  const bob = await makeUser(bobEmail, { fullyOnboarded: true });
  const carol = await makeUser(carolEmail, { fullyOnboarded: true });
  const david = await makeUser(davidEmail, { fullyOnboarded: true });
  const erin = await makeUser(erinEmail, { fullyOnboarded: false }); // skeletal
  const frank = await makeUser(frankEmail, { fullyOnboarded: true });

  const adminClient = await userClient(adminEmail);
  const aliceClient = await userClient(aliceEmail);
  const bobClient = await userClient(bobEmail);
  const carolClient = await userClient(carolEmail);
  const davidClient = await userClient(davidEmail);
  const erinClient = await userClient(erinEmail);
  const frankClient = await userClient(frankEmail);

  console.log(
    `[smoke-event-rsvp] seeded admin + 6 members (4 onboarded, 1 not onboarded, 1 invitee)`
  );

  const createdEventIds: string[] = [];
  try {
    const starts = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const ends = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString();

    // ===== Part A: members-visibility event, capacity=2, waitlist on =====
    const { data: evId, error: cErr } = await adminClient.rpc("create_event", {
      p_payload: {
        slug: `rsvp-smoke-${suffix}`,
        title: "RSVP Smoke Event",
        visibility: "members",
        starts_at: starts,
        ends_at: ends,
        capacity: 2,
        waitlist_enabled: true,
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
    console.log(`[smoke-event-rsvp] OK: seeded published event cap=2 waitlist=true`);

    // 1. Alice RSVPs going → effective going.
    const { data: aliceEff, error: aliceErr } = await aliceClient.rpc(
      "rsvp_to_event",
      { p_event_id: eventId, p_desired: "going" }
    );
    if (aliceErr) throw new Error(`alice rsvp: ${aliceErr.message}`);
    if (aliceEff !== "going") throw new Error(`alice effective: ${aliceEff}`);
    console.log(`[smoke-event-rsvp] OK: alice RSVP going → going`);

    // 2. Bob RSVPs going → effective going (fills capacity).
    const { data: bobEff, error: bobErr } = await bobClient.rpc("rsvp_to_event", {
      p_event_id: eventId,
      p_desired: "going",
    });
    if (bobErr) throw new Error(`bob rsvp: ${bobErr.message}`);
    if (bobEff !== "going") throw new Error(`bob effective: ${bobEff}`);
    console.log(`[smoke-event-rsvp] OK: bob RSVP going → going`);

    // 3. Carol RSVPs going → effective waitlisted.
    const { data: carolEff, error: carolErr } = await carolClient.rpc(
      "rsvp_to_event",
      { p_event_id: eventId, p_desired: "going" }
    );
    if (carolErr) throw new Error(`carol rsvp: ${carolErr.message}`);
    if (carolEff !== "waitlisted") {
      throw new Error(`carol effective: ${carolEff}`);
    }
    const { data: carolRow } = await admin
      .from("event_rsvps")
      .select("status, waitlisted_at")
      .eq("event_id", eventId)
      .eq("user_id", carol.id)
      .single();
    if (carolRow?.status !== "waitlisted" || !carolRow?.waitlisted_at) {
      throw new Error(
        `carol row expected waitlisted w/ waitlisted_at: ${JSON.stringify(carolRow)}`
      );
    }
    console.log(
      `[smoke-event-rsvp] OK: carol RSVP going → waitlisted (waitlisted_at set)`
    );

    // 4. David attempts direct insert into event_rsvps → RLS denies.
    const { error: davidDirectErr, data: davidDirectData } = await davidClient
      .from("event_rsvps")
      .insert({
        event_id: eventId,
        user_id: david.id,
        status: "going",
      })
      .select();
    // RLS on event_rsvps defines `with check (false)` for client inserts.
    // PostgREST typically returns 42501 or a zero-row insert. We accept either
    // an error or zero rows, then confirm no row exists.
    const davidHasRow = !davidDirectErr && davidDirectData && davidDirectData.length > 0;
    if (davidHasRow) {
      throw new Error(
        `david direct insert succeeded: ${JSON.stringify(davidDirectData)}`
      );
    }
    const { data: davidCheck } = await admin
      .from("event_rsvps")
      .select("user_id")
      .eq("event_id", eventId)
      .eq("user_id", david.id);
    if (davidCheck && davidCheck.length > 0) {
      throw new Error(`david row appeared despite denial`);
    }
    console.log(
      `[smoke-event-rsvp] OK: direct insert into event_rsvps denied (err=${davidDirectErr?.code ?? "none"})`
    );

    // 5. Erin (not fully onboarded) calls rsvp_to_event → P0001.
    const { error: erinErr } = await erinClient.rpc("rsvp_to_event", {
      p_event_id: eventId,
      p_desired: "going",
    });
    if (!erinErr) throw new Error("erin rsvp should fail");
    if (erinErr.code !== "P0001") {
      throw new Error(`expected P0001 (not fully onboarded), got ${erinErr.code}`);
    }
    console.log(
      `[smoke-event-rsvp] OK: not-fully-onboarded rsvp_to_event → P0001`
    );

    // 6. Bob cancels → slot opens. Admin promotes Carol.
    const { data: bobCancel, error: bobCancelErr } = await bobClient.rpc(
      "rsvp_to_event",
      { p_event_id: eventId, p_desired: "cancelled" }
    );
    if (bobCancelErr) throw new Error(`bob cancel: ${bobCancelErr.message}`);
    if (bobCancel !== "cancelled") {
      throw new Error(`bob cancel effective: ${bobCancel}`);
    }
    console.log(`[smoke-event-rsvp] OK: bob cancelled RSVP (slot opened)`);

    const { error: promoteErr } = await adminClient.rpc(
      "promote_waitlisted_member",
      { p_event_id: eventId, p_user_id: carol.id }
    );
    if (promoteErr) throw new Error(`promote: ${promoteErr.message}`);
    const { data: carolAfter } = await admin
      .from("event_rsvps")
      .select("status, waitlisted_at")
      .eq("event_id", eventId)
      .eq("user_id", carol.id)
      .single();
    if (carolAfter?.status !== "going") {
      throw new Error(`carol after promote status: ${carolAfter?.status}`);
    }
    if (carolAfter?.waitlisted_at !== null) {
      throw new Error(
        `carol waitlisted_at should be null after promote: ${carolAfter?.waitlisted_at}`
      );
    }
    console.log(
      `[smoke-event-rsvp] OK: admin promote_waitlisted_member → going, waitlisted_at cleared`
    );

    // 7. Non-admin attempting promote → P0001.
    const { error: memberPromoteErr } = await aliceClient.rpc(
      "promote_waitlisted_member",
      { p_event_id: eventId, p_user_id: carol.id }
    );
    if (!memberPromoteErr || memberPromoteErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on member promote, got ${memberPromoteErr?.code}`
      );
    }
    console.log(
      `[smoke-event-rsvp] OK: non-admin promote_waitlisted_member → P0001`
    );

    // ===== Part B: private-invite event =====
    const { data: privId, error: privErr } = await adminClient.rpc(
      "create_event",
      {
        p_payload: {
          slug: `rsvp-priv-${suffix}`,
          title: "Private invite smoke",
          visibility: "private_invite",
          starts_at: starts,
          ends_at: ends,
          capacity: null,
          waitlist_enabled: false,
        },
      }
    );
    if (privErr || typeof privId !== "string") {
      throw new Error(`priv create_event: ${privErr?.message}`);
    }
    const privEventId = privId;
    createdEventIds.push(privEventId);
    await adminClient.rpc("publish_event", { p_event_id: privEventId });

    // 8. Alice (non-invitee) rsvp fails (not visible).
    const { error: aliceBlockedErr } = await aliceClient.rpc("rsvp_to_event", {
      p_event_id: privEventId,
      p_desired: "going",
    });
    if (!aliceBlockedErr) {
      throw new Error("non-invitee rsvp to private should fail");
    }
    if (aliceBlockedErr.code !== "P0001") {
      throw new Error(
        `expected P0001 on non-invitee rsvp, got ${aliceBlockedErr.code}: ${aliceBlockedErr.message}`
      );
    }
    console.log(
      `[smoke-event-rsvp] OK: non-invitee rsvp to private_invite → P0001`
    );

    // 9. Admin invites Frank. Frank's rsvp now succeeds.
    const { error: invErr } = await adminClient.rpc("invite_member_to_event", {
      p_event_id: privEventId,
      p_user_id: frank.id,
    });
    if (invErr) throw new Error(`invite: ${invErr.message}`);

    const { data: frankEff, error: frankRsvpErr } = await frankClient.rpc(
      "rsvp_to_event",
      { p_event_id: privEventId, p_desired: "going" }
    );
    if (frankRsvpErr) throw new Error(`frank rsvp: ${frankRsvpErr.message}`);
    if (frankEff !== "going") {
      throw new Error(`frank effective: ${frankEff}`);
    }
    console.log(
      `[smoke-event-rsvp] OK: invitee rsvp to private_invite → going`
    );

    console.log("[smoke-event-rsvp] ALL OK");
  } finally {
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const u of [adminUser, alice, bob, carol, david, erin, frank]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-event-rsvp] FAILED:", err);
  process.exit(1);
});
