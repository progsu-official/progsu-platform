#!/usr/bin/env tsx
// Smoke: R2 member-card visibility. Exercises every scenario from
// docs/10-r2-member-card-spec.md §8 plus the hard-gate assertions in §11.
//
// All tests run against a fresh `supabase db reset`.

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();
  const { createClient } = await import("@supabase/supabase-js");

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const suffix = Date.now();
  const createdUserIds: string[] = [];
  const password = "visibility-smoke-1234";

  async function seedUser(
    label: string,
    {
      isAdmin = false,
      onboarded = true,
      visibilitySettings = null,
    }: {
      isAdmin?: boolean;
      onboarded?: boolean;
      visibilitySettings?: {
        discoverable?: boolean;
        share_attended_events?: boolean;
        share_shared_event_counts?: boolean;
      } | null;
    } = {}
  ): Promise<string> {
    const email = `${label}-${suffix}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create ${label}: ${error?.message}`);
    const uid = data.user.id;
    createdUserIds.push(uid);

    const profileUpdate: Record<string, unknown> = {
      is_admin: isAdmin,
      phone_number: "555-555-5555",
    };
    if (onboarded) {
      Object.assign(profileUpdate, {
        first_name: label,
        last_name: "Smoke",
        preferred_name: null,
        school: "Georgia State University",
        major: "CS",
        class_standing: "junior",
        grad_year: 2027,
        grad_term: "Spring 2027",
        interested_roles: ["software_engineering"],
      });
    }
    const { error: profileErr } = await admin
      .from("profiles")
      .update(profileUpdate)
      .eq("id", uid);
    if (profileErr) throw new Error(`profile update ${label}: ${profileErr.message}`);

    if (onboarded) {
      const { data: versions } = await admin
        .from("consent_versions")
        .select("consent_type, version");
      for (const v of versions ?? []) {
        await admin.from("consents").insert({
          user_id: uid,
          consent_type: v.consent_type,
          accepted: true,
          version: v.version,
        });
      }
      await admin.from("resumes").insert({
        user_id: uid,
        storage_path: `${uid}/resume-${suffix}.pdf`,
        file_name: "resume.pdf",
        file_size: 1024,
        mime_type: "application/pdf",
        status: "active",
        is_current: true,
      });
    }

    if (visibilitySettings) {
      // Go through the RPC so auto-slug generation and audit rows match what
      // the app produces. Must sign in as this user to call the self-only RPC.
      const userClient = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      );
      await userClient.auth.signInWithPassword({ email, password });
      const { error: visErr } = await userClient.rpc("set_profile_visibility", {
        p_payload: visibilitySettings,
      });
      if (visErr) {
        throw new Error(`set_profile_visibility ${label}: ${visErr.message}`);
      }
      await userClient.auth.signOut();
    }

    return uid;
  }

  async function signIn(label: string) {
    const client = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
    const { error } = await client.auth.signInWithPassword({
      email: `${label}-${suffix}@example.com`,
      password,
    });
    if (error) throw new Error(`sign in ${label}: ${error.message}`);
    return client;
  }

  async function slugFor(userId: string): Promise<string> {
    const { data } = await admin
      .from("profile_visibility_settings")
      .select("profile_slug")
      .eq("user_id", userId)
      .single();
    const slug = (data as { profile_slug: string | null } | null)?.profile_slug;
    if (!slug) throw new Error(`no slug for ${userId}`);
    return slug;
  }

  async function countAudit(
    action: string,
    actor?: string,
    target?: string
  ): Promise<number> {
    let q = admin
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("action", action);
    if (actor) q = q.eq("actor_user_id", actor);
    if (target) q = q.eq("target_user_id", target);
    const { count } = await q;
    return count ?? 0;
  }

  try {
    // --- Seed fixtures -----------------------------------------------------
    const aliceId = await seedUser("alice-opt-in", {
      visibilitySettings: {
        discoverable: true,
        share_attended_events: true,
      },
    });
    const bobId = await seedUser("bob-opt-in-no-events", {
      visibilitySettings: {
        discoverable: true,
        share_attended_events: false,
      },
    });
    const carolId = await seedUser("carol-private");
    const daveId = await seedUser("dave-unonboarded", { onboarded: false });
    const erinId = await seedUser("erin-opt-in", {
      visibilitySettings: {
        discoverable: true,
        share_attended_events: true,
      },
    });
    const malloryId = await seedUser("mallory-admin", { isAdmin: true });

    console.log(
      `[smoke-member-cards-visibility] seeded 6 users (alice=${aliceId.slice(0, 8)}, bob=${bobId.slice(0, 8)}, carol=${carolId.slice(0, 8)}, dave=${daveId.slice(0, 8)}, erin=${erinId.slice(0, 8)}, admin=${malloryId.slice(0, 8)})`
    );

    // Seed some events + attendance for alice so the attended-events helper
    // has something real to filter.
    const nowIso = new Date().toISOString();
    const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString();

    async function seedEvent(
      slug: string,
      opts: { is_sensitive?: boolean; visibility?: string; status?: string }
    ) {
      const { data } = await admin
        .from("events")
        .insert({
          slug: `${slug}-${suffix}`,
          title: `${slug} event`,
          status: opts.status ?? "published",
          visibility: opts.visibility ?? "members",
          starts_at: pastStart,
          ends_at: pastEnd,
          is_sensitive: opts.is_sensitive ?? false,
          published_at: opts.status === "draft" ? null : nowIso,
        })
        .select("id")
        .single();
      return (data as { id: string }).id;
    }

    const publicEventId = await seedEvent("public-big", {});
    const sensitiveEventId = await seedEvent("public-sensitive", {
      is_sensitive: true,
    });
    const privateInviteEventId = await seedEvent("private-invite", {
      visibility: "private_invite",
    });

    for (const eid of [publicEventId, sensitiveEventId, privateInviteEventId]) {
      await admin.from("event_attendances").insert({
        event_id: eid,
        user_id: aliceId,
        method: "admin_click",
        checked_in_by: malloryId,
      });
    }

    // Alice's slug is auto-generated on opt-in; discover it.
    const aliceSlug = await slugFor(aliceId);
    const bobSlug = await slugFor(bobId);
    const erinSlug = await slugFor(erinId);

    // --- Scenario 1: self-view (alice views own card) ---------------------
    {
      const aliceClient = await signIn("alice-opt-in");
      const beforeAudit = await countAudit("member.card_view", aliceId);
      const { data, error } = await aliceClient.rpc("member_card_for_viewer", {
        p_viewer_id: aliceId,
        p_target_slug: aliceSlug,
      });
      if (error) throw new Error(`self view: ${error.message}`);
      if ((data ?? []).length !== 1) throw new Error(`self view rows != 1`);
      const afterAudit = await countAudit("member.card_view", aliceId);
      if (afterAudit !== beforeAudit) {
        throw new Error(`self view wrote audit (before=${beforeAudit}, after=${afterAudit})`);
      }
      console.log(`[smoke-member-cards-visibility] OK: self-view 1 row, no audit`);
    }

    // --- Scenario 2: peer views opted-in target (bob → alice) ------------
    {
      const bobClient = await signIn("bob-opt-in-no-events");
      const beforeAudit = await countAudit("member.card_view", bobId, aliceId);
      const { data, error } = await bobClient.rpc("member_card_for_viewer", {
        p_viewer_id: bobId,
        p_target_slug: aliceSlug,
      });
      if (error) throw new Error(`peer view: ${error.message}`);
      if ((data ?? []).length !== 1) {
        throw new Error(`peer view rows != 1 (${JSON.stringify(data)})`);
      }
      const afterAudit = await countAudit("member.card_view", bobId, aliceId);
      if (afterAudit !== beforeAudit + 1) {
        throw new Error(`peer view audit not written (before=${beforeAudit}, after=${afterAudit})`);
      }
      console.log(`[smoke-member-cards-visibility] OK: peer view 1 row, 1 audit`);
    }

    // --- Scenario 3: peer views non-discoverable target (bob → carol) ----
    //     Carol has no visibility row at all → slug resolution returns null.
    //     We can't use carol's slug (she has none); attempt a fake slug.
    {
      const bobClient = await signIn("bob-opt-in-no-events");
      const { data } = await bobClient.rpc("member_card_for_viewer", {
        p_viewer_id: bobId,
        p_target_slug: "carol-private-does-not-exist",
      });
      if ((data ?? []).length !== 0) throw new Error(`non-discoverable returned rows`);
      console.log(
        `[smoke-member-cards-visibility] OK: non-discoverable/unknown slug returns empty`
      );
    }

    // --- Scenario 4: unknown slug --------------------------------------
    {
      const bobClient = await signIn("bob-opt-in-no-events");
      const before = await countAudit("member.card_view", bobId);
      const { data } = await bobClient.rpc("member_card_for_viewer", {
        p_viewer_id: bobId,
        p_target_slug: "this-slug-never-existed",
      });
      if ((data ?? []).length !== 0) throw new Error(`unknown slug returned rows`);
      const after = await countAudit("member.card_view", bobId);
      if (after !== before) {
        throw new Error(`unknown slug wrote audit`);
      }
      console.log(`[smoke-member-cards-visibility] OK: unknown slug empty + no audit`);
    }

    // --- Scenario 5: admin views any card --------------------------------
    {
      const adminClient = await signIn("mallory-admin");
      const before = await countAudit("member.card_view", malloryId, aliceId);
      const { data } = await adminClient.rpc("member_card_for_viewer", {
        p_viewer_id: malloryId,
        p_target_slug: aliceSlug,
      });
      if ((data ?? []).length !== 1) throw new Error(`admin view rows != 1`);
      const after = await countAudit("member.card_view", malloryId, aliceId);
      if (after !== before + 1) throw new Error(`admin view audit not written`);
      // Verify is_admin: true appears in metadata.
      const { data: auditRow } = await admin
        .from("audit_log")
        .select("metadata")
        .eq("action", "member.card_view")
        .eq("actor_user_id", malloryId)
        .eq("target_user_id", aliceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      const meta = (auditRow as { metadata: { is_admin: boolean } } | null)?.metadata;
      if (!meta?.is_admin) throw new Error(`admin audit missing is_admin metadata`);
      console.log(`[smoke-member-cards-visibility] OK: admin view audited with is_admin:true`);
    }

    // --- Scenario 8/9: attended-events gates ----------------------------
    {
      const bobClient = await signIn("bob-opt-in-no-events");
      // Target carol: not discoverable → no rows even though share flag is irrelevant.
      const { data: carolAttempt } = await bobClient.rpc(
        "member_card_attended_events_for_viewer",
        { p_viewer_id: bobId, p_target_id: carolId }
      );
      if ((carolAttempt ?? []).length !== 0) {
        throw new Error(`non-discoverable target returned attended events`);
      }

      // Target bob himself has share_attended_events = false.
      const aliceClient = await signIn("alice-opt-in");
      const { data: bobAttempt } = await aliceClient.rpc(
        "member_card_attended_events_for_viewer",
        { p_viewer_id: aliceId, p_target_id: bobId }
      );
      if ((bobAttempt ?? []).length !== 0) {
        throw new Error(`share=false target returned attended events`);
      }
      console.log(
        `[smoke-member-cards-visibility] OK: non-discoverable and share=false targets both empty`
      );
    }

    // --- Scenario 10: share_attended_events = true filters events --------
    {
      const erinClient = await signIn("erin-opt-in");
      const before = await countAudit(
        "member.card_attended_events_view",
        erinId,
        aliceId
      );
      const { data, error } = await erinClient.rpc(
        "member_card_attended_events_for_viewer",
        { p_viewer_id: erinId, p_target_id: aliceId }
      );
      if (error) throw new Error(`attended-events view: ${error.message}`);
      const rows = (data ?? []) as Array<{ event_id: string }>;
      if (rows.length !== 1) {
        throw new Error(
          `expected 1 event (public-big only), got ${rows.length}: ${JSON.stringify(rows)}`
        );
      }
      if (rows[0].event_id !== publicEventId) {
        throw new Error(`expected public event, got ${rows[0].event_id}`);
      }
      const after = await countAudit(
        "member.card_attended_events_view",
        erinId,
        aliceId
      );
      if (after !== before + 1) throw new Error(`attended-events view audit not written`);
      console.log(
        `[smoke-member-cards-visibility] OK: share=true filters sensitive+private_invite, audit written`
      );
    }

    // --- Scenario 11 (Blocker B): peer cannot read raw profile fields ----
    {
      const bobClient = await signIn("bob-opt-in-no-events");
      const denied = [
        "phone_number",
        "google_email",
        "student_email",
        "is_admin",
        "student_email_verified",
      ] as const;
      for (const col of denied) {
        const { data, error } = await bobClient
          .from("profiles")
          .select(`id, ${col}`)
          .eq("id", aliceId);
        if (error) {
          // Some columns may throw — also acceptable as long as we can't read.
          continue;
        }
        if (data && data.length > 0) {
          throw new Error(
            `peer-read of ${col} returned a row: ${JSON.stringify(data)}`
          );
        }
      }
      // Positive control: bob CAN select his own row.
      const { data: selfRow } = await bobClient
        .from("profiles")
        .select("id, phone_number")
        .eq("id", bobId)
        .single();
      if (!selfRow) throw new Error(`self-read on profiles unexpectedly failed`);
      console.log(
        `[smoke-member-cards-visibility] OK: peer raw-profile reads all denied; self-read works`
      );
    }

    // --- Scenario 12: member_cards view exposes only allow-list ---------
    {
      const aliceClient = await signIn("alice-opt-in");
      const { data, error } = await aliceClient
        .from("member_cards")
        .select("*")
        .eq("user_id", aliceId)
        .maybeSingle();
      if (error) throw new Error(`member_cards self-select: ${error.message}`);
      if (!data) throw new Error(`alice couldn't see her own member_card row`);
      // student_email_verified is a deliberate exception (2026-08-20,
      // per John): the education card shows a verification badge to peers
      // without the raw email itself, so it's excluded from this list on
      // purpose — see member_cards' own comment in
      // 20260820210000_public_profile_sections.sql. Everything else here
      // still must never appear in the sanitized peer-facing projection.
      const forbidden = [
        "google_email",
        "student_email",
        "phone_number",
        "is_admin",
      ];
      for (const f of forbidden) {
        if (f in (data as Record<string, unknown>)) {
          throw new Error(`member_cards exposes forbidden field: ${f}`);
        }
      }
      console.log(
        `[smoke-member-cards-visibility] OK: member_cards view exposes only whitelist`
      );
    }

    // --- Scenario 13: slug collision on first opt-in -------------------
    {
      // Seed two users with identical names and opt them in; they should get
      // different slugs (second gets a suffix).
      const colAId = await seedUser("colli-alpha");
      const colBId = await seedUser("colli-alpha-dupe");
      // Force both to the same base slug by directly updating profile names.
      await admin
        .from("profiles")
        .update({ first_name: "Dup", last_name: "Lastname" })
        .in("id", [colAId, colBId]);

      const aClient = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      );
      await aClient.auth.signInWithPassword({
        email: `colli-alpha-${suffix}@example.com`,
        password,
      });
      await aClient.rpc("set_profile_visibility", {
        p_payload: { discoverable: true },
      });

      const bClient = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      );
      await bClient.auth.signInWithPassword({
        email: `colli-alpha-dupe-${suffix}@example.com`,
        password,
      });
      await bClient.rpc("set_profile_visibility", {
        p_payload: { discoverable: true },
      });

      const slugA = await slugFor(colAId);
      const slugB = await slugFor(colBId);
      if (slugA === slugB) {
        throw new Error(`slug collision not resolved: both = ${slugA}`);
      }
      if (!slugB.startsWith(slugA)) {
        // Suffix path keeps the base + "-xxxx"; if both started from similar
        // seeds that's fine, just ensure they're different.
      }
      console.log(
        `[smoke-member-cards-visibility] OK: slug collision resolved (A=${slugA}, B=${slugB})`
      );
    }

    // --- Scenario 14: rename-to-taken raises explicit error ------------
    {
      const aliceClient = await signIn("alice-opt-in");
      const { error } = await aliceClient.rpc("set_profile_slug", {
        p_desired_slug: bobSlug,
      });
      if (!error) throw new Error(`rename to taken slug should fail`);
      if (!/taken/i.test(error.message)) {
        throw new Error(`expected 'taken' error, got: ${error.message}`);
      }
      console.log(
        `[smoke-member-cards-visibility] OK: rename to taken slug raises explicit error`
      );
    }

    // --- Scenario 15: stale privacy_policy version blocks discoverable=true
    {
      // Create a fresh user, insert a stale privacy_policy consent, try to flip on.
      const staleId = await seedUser("stale-privacy", { onboarded: false });
      await admin.from("profiles").update({
        first_name: "Stale",
        last_name: "Smoke",
        school: "Georgia State University",
        major: "CS",
        class_standing: "junior",
        grad_year: 2027,
        grad_term: "Spring 2027",
        interested_roles: ["software_engineering"],
      }).eq("id", staleId);
      await admin.from("resumes").insert({
        user_id: staleId,
        storage_path: `${staleId}/resume-${suffix}.pdf`,
        file_name: "resume.pdf",
        file_size: 1024,
        mime_type: "application/pdf",
        status: "active",
        is_current: true,
      });
      // Everything but privacy_policy at current; privacy_policy at v0 (stale).
      const { data: versions } = await admin
        .from("consent_versions")
        .select("consent_type, version");
      for (const v of versions ?? []) {
        if (v.consent_type === "privacy_policy") continue;
        await admin.from("consents").insert({
          user_id: staleId,
          consent_type: v.consent_type,
          accepted: true,
          version: v.version,
        });
      }
      await admin.from("consents").insert({
        user_id: staleId,
        consent_type: "privacy_policy",
        accepted: true,
        version: "v0",
      });

      const staleClient = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      );
      await staleClient.auth.signInWithPassword({
        email: `stale-privacy-${suffix}@example.com`,
        password,
      });
      const { error } = await staleClient.rpc("set_profile_visibility", {
        p_payload: { discoverable: true },
      });
      // is_fully_onboarded will catch this first because stale privacy_policy
      // breaks the required-consents check. Either error is acceptable — both
      // prevent the flip.
      if (!error) throw new Error(`stale-privacy flip should raise`);
      if (
        !/reaccept_privacy|not fully onboarded/i.test(error.message)
      ) {
        throw new Error(`expected reaccept/onboarded error, got: ${error.message}`);
      }
      console.log(
        `[smoke-member-cards-visibility] OK: stale privacy_policy blocks discoverable flip`
      );
    }

    // --- Scenario 16: toggle off then on preserves slug -----------------
    {
      const aliceClient = await signIn("alice-opt-in");
      const slugBefore = await slugFor(aliceId);
      await aliceClient.rpc("set_profile_visibility", {
        p_payload: { discoverable: false },
      });
      await aliceClient.rpc("set_profile_visibility", {
        p_payload: { discoverable: true },
      });
      const slugAfter = await slugFor(aliceId);
      if (slugBefore !== slugAfter) {
        throw new Error(`slug changed across toggle: ${slugBefore} → ${slugAfter}`);
      }
      console.log(
        `[smoke-member-cards-visibility] OK: toggle off→on preserves slug (${slugAfter})`
      );
    }

    // --- Scenario 17: admin can query audit_log for peer views -----------
    {
      const { count } = await admin
        .from("audit_log")
        .select("*", { count: "exact", head: true })
        .eq("action", "member.card_view")
        .eq("actor_user_id", bobId);
      if ((count ?? 0) < 1) {
        throw new Error(`expected >=1 peer-view audit row for bob`);
      }
      console.log(
        `[smoke-member-cards-visibility] OK: admin can read peer-view audit rows (${count})`
      );
    }

    // --- list_member_cards basic sanity ----------------------------------
    {
      const erinClient = await signIn("erin-opt-in");
      const { data, error } = await erinClient.rpc("list_member_cards", {
        p_viewer_id: erinId,
        p_cursor_ts: null,
        p_cursor_user: null,
        p_limit: 50,
        p_search: null,
      });
      if (error) throw new Error(`list_member_cards: ${error.message}`);
      const rows = (data ?? []) as Array<{ user_id: string }>;
      const ids = new Set(rows.map((r) => r.user_id));
      if (!ids.has(aliceId)) throw new Error(`list missing alice`);
      if (!ids.has(bobId)) throw new Error(`list missing bob`);
      if (!ids.has(erinId)) throw new Error(`list missing erin (self)`);
      if (ids.has(carolId)) throw new Error(`list included carol (not discoverable)`);
      console.log(
        `[smoke-member-cards-visibility] OK: list_member_cards returns only discoverable rows (${rows.length} shown)`
      );
    }

    console.log("[smoke-member-cards-visibility] ALL OK");
  } finally {
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    await admin
      .from("events")
      .delete()
      .like("slug", `%-${suffix}`);
  }
}

main().catch((err) => {
  console.error("[smoke-member-cards-visibility] FAILED:", err);
  process.exit(1);
});
