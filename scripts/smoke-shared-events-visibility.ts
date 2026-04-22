#!/usr/bin/env tsx
// Smoke: R3 shared-event discovery. Covers the §11 merge-blocker assertions
// plus the rendering-case cases from §6.2. Runs against a fresh db reset.
//
// The SHARED_EVENT_MIN_ATTENDEES constant in the helper is 2 for dogfood
// (see migration 20260425000100). This smoke builds around that: it seeds
// 2 attendees when it wants "above threshold" and 1 when it wants below.
// If the constant is raised for public launch, the threshold-boundary
// scenarios need updating too.

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
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const password = "shared-smoke-1234";

  async function seedUser(
    label: string,
    {
      onboarded = true,
      isAdmin = false,
      visibility = null as {
        discoverable?: boolean;
        share_attended_events?: boolean;
        share_shared_event_counts?: boolean;
      } | null,
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

    if (onboarded) {
      await admin
        .from("profiles")
        .update({
          first_name: label,
          last_name: "Shared",
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
        file_name: "resume.pdf",
        file_size: 1024,
        mime_type: "application/pdf",
        status: "active",
        is_current: true,
      });
    } else if (isAdmin) {
      await admin.from("profiles").update({ is_admin: true }).eq("id", uid);
    }

    if (visibility) {
      const userClient = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      );
      await userClient.auth.signInWithPassword({ email, password });
      const { error: visErr } = await userClient.rpc("set_profile_visibility", {
        p_payload: visibility,
      });
      if (visErr) {
        throw new Error(`set_profile_visibility ${label}: ${visErr.message}`);
      }
      await userClient.auth.signOut();
    }

    return uid;
  }

  async function seedEvent(opts: {
    slug: string;
    status?: string;
    visibility?: string;
    is_sensitive?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString();
    const status = opts.status ?? "published";
    // events_cancellation_pair: status=cancelled iff cancelled_at IS NOT NULL.
    const cancelledAt = status === "cancelled" ? new Date().toISOString() : null;
    const { error } = await admin.from("events").insert({
      id,
      slug: `${opts.slug}-${suffix}`,
      title: `${opts.slug} event`,
      status,
      visibility: opts.visibility ?? "members",
      starts_at: pastStart,
      ends_at: pastEnd,
      is_sensitive: opts.is_sensitive ?? false,
      published_at: status === "draft" ? null : new Date().toISOString(),
      cancelled_at: cancelledAt,
      cancellation_reason: status === "cancelled" ? "smoke test" : null,
    });
    if (error) throw new Error(`seedEvent ${opts.slug}: ${error.message}`);
    createdEventIds.push(id);
    return id;
  }

  async function addAttendance(eventId: string, userId: string, adminId: string) {
    await admin.from("event_attendances").insert({
      event_id: eventId,
      user_id: userId,
      method: "admin_click",
      checked_in_by: adminId,
    });
  }

  async function signIn(label: string) {
    const c = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
    const { error } = await c.auth.signInWithPassword({
      email: `${label}-${suffix}@example.com`,
      password,
    });
    if (error) throw new Error(`sign in ${label}: ${error.message}`);
    return c;
  }

  async function countAudit(action: string, actor?: string, target?: string) {
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
    const adminId = await seedUser("mallory-admin", { isAdmin: true });

    const aliceId = await seedUser("alice-shared", {
      visibility: {
        discoverable: true,
        share_attended_events: true,
        share_shared_event_counts: true,
      },
    });
    const bobId = await seedUser("bob-shared", {
      visibility: {
        discoverable: true,
        share_attended_events: true,
        share_shared_event_counts: true,
      },
    });
    const carolId = await seedUser("carol-no-counts", {
      visibility: {
        discoverable: true,
        share_attended_events: true,
        share_shared_event_counts: false,
      },
    });
    const daveId = await seedUser("dave-private");

    console.log(
      `[smoke-shared-events] seeded users alice=${aliceId.slice(0, 8)} bob=${bobId.slice(0, 8)} carol=${carolId.slice(0, 8)} dave=${daveId.slice(0, 8)}`
    );

    const publicBigId = await seedEvent({ slug: "public-big" });
    const publicSensitiveId = await seedEvent({
      slug: "public-sensitive",
      is_sensitive: true,
    });
    const publicSmallId = await seedEvent({ slug: "public-small" });
    const privateInviteId = await seedEvent({
      slug: "private-invite",
      visibility: "private_invite",
    });
    const draftId = await seedEvent({ slug: "draft", status: "draft" });
    const cancelledId = await seedEvent({
      slug: "cancelled",
      status: "cancelled",
    });
    const archivedId = await seedEvent({
      slug: "archived",
      status: "archived",
    });

    for (const [eid, users] of [
      [publicBigId, [aliceId, bobId, carolId]],
      [publicSensitiveId, [aliceId, bobId, carolId]],
      [publicSmallId, [aliceId, bobId]],
      [privateInviteId, [aliceId, bobId]],
      [draftId, [aliceId, bobId]],
      [cancelledId, [aliceId, bobId]],
      [archivedId, [aliceId, bobId]],
    ] as const) {
      for (const uid of users) {
        await addAttendance(eid, uid, adminId);
      }
    }

    // --- Scenario 1: mutual opt-in happy path (alice → bob) ---
    {
      const alice = await signIn("alice-shared");
      const beforeAudit = await countAudit(
        "member.shared_events_view",
        aliceId,
        bobId
      );
      const { data, error } = await alice.rpc("shared_events_for_viewer", {
        p_viewer_id: aliceId,
        p_target_id: bobId,
      });
      if (error) throw new Error(`happy path: ${error.message}`);
      const row = (data ?? [])[0] as {
        event_count: number;
        named_events: Array<{ event_id: string }>;
      };
      if (!row) throw new Error(`happy path returned no row`);

      // alice+bob both attended: public-big, public-sensitive, public-small,
      // private-invite, draft, cancelled, archived.
      // Eligible for aggregate (>=2 attendees, not draft/archived, not private_invite):
      //   public-big (3), public-sensitive (3), public-small (2), cancelled (2) → 4
      // Named (above AND not sensitive):
      //   public-big, public-small, cancelled → 3
      if (row.event_count !== 4) {
        throw new Error(
          `expected event_count=4, got ${row.event_count}. named=${JSON.stringify(row.named_events)}`
        );
      }
      if (row.named_events.length !== 3) {
        throw new Error(
          `expected 3 named events, got ${row.named_events.length}: ${JSON.stringify(row.named_events)}`
        );
      }
      const namedIds = new Set(row.named_events.map((e) => e.event_id));
      if (!namedIds.has(publicBigId))
        throw new Error(`public-big missing from named`);
      if (!namedIds.has(publicSmallId))
        throw new Error(`public-small missing from named`);
      if (!namedIds.has(cancelledId))
        throw new Error(`cancelled missing from named`);
      if (namedIds.has(publicSensitiveId))
        throw new Error(`public-sensitive leaked into named`);
      if (namedIds.has(privateInviteId))
        throw new Error(`private-invite leaked into named`);
      if (namedIds.has(draftId)) throw new Error(`draft leaked into named`);
      if (namedIds.has(archivedId))
        throw new Error(`archived leaked into named`);

      const afterAudit = await countAudit(
        "member.shared_events_view",
        aliceId,
        bobId
      );
      if (afterAudit !== beforeAudit + 1)
        throw new Error(`audit not written on happy path`);
      console.log(
        `[smoke-shared-events] OK: mutual opt-in returns 4 aggregate, 3 named; audit written`
      );
    }

    // --- Scenario 2: self-view returns (0, []) no audit ---
    {
      const alice = await signIn("alice-shared");
      const before = await countAudit("member.shared_events_view", aliceId);
      const { data } = await alice.rpc("shared_events_for_viewer", {
        p_viewer_id: aliceId,
        p_target_id: aliceId,
      });
      const row = (data ?? [])[0] as {
        event_count: number;
        named_events: unknown[];
      };
      if (row.event_count !== 0) throw new Error(`self-view event_count != 0`);
      if (row.named_events.length !== 0)
        throw new Error(`self-view named not empty`);
      const after = await countAudit("member.shared_events_view", aliceId);
      if (after !== before) throw new Error(`self-view wrote audit`);
      console.log(
        `[smoke-shared-events] OK: self-view returns empty, no audit`
      );
    }

    // --- Scenario 3: target opted out (alice → carol) ---
    {
      const alice = await signIn("alice-shared");
      const before = await countAudit(
        "member.shared_events_view",
        aliceId,
        carolId
      );
      const { data } = await alice.rpc("shared_events_for_viewer", {
        p_viewer_id: aliceId,
        p_target_id: carolId,
      });
      const row = (data ?? [])[0] as { event_count: number };
      if (row.event_count !== 0)
        throw new Error(`target opted-out returned rows`);
      const after = await countAudit(
        "member.shared_events_view",
        aliceId,
        carolId
      );
      if (after !== before) throw new Error(`target opted-out wrote audit`);
      console.log(
        `[smoke-shared-events] OK: target opted-out returns empty, no audit`
      );
    }

    // --- Scenario 4: viewer opted out ---
    {
      const alice = await signIn("alice-shared");
      await alice.rpc("set_profile_visibility", {
        p_payload: { share_shared_event_counts: false },
      });
      const { data } = await alice.rpc("shared_events_for_viewer", {
        p_viewer_id: aliceId,
        p_target_id: bobId,
      });
      const row = (data ?? [])[0] as { event_count: number };
      if (row.event_count !== 0)
        throw new Error(`viewer opted-out returned rows`);
      await alice.rpc("set_profile_visibility", {
        p_payload: { share_shared_event_counts: true },
      });
      console.log(`[smoke-shared-events] OK: viewer opted-out returns empty`);
    }

    // --- Scenario 5: target not discoverable (alice → dave) ---
    {
      const alice = await signIn("alice-shared");
      const { data } = await alice.rpc("shared_events_for_viewer", {
        p_viewer_id: aliceId,
        p_target_id: daveId,
      });
      const row = (data ?? [])[0] as { event_count: number };
      if (row.event_count !== 0)
        throw new Error(`non-discoverable target returned rows`);
      console.log(
        `[smoke-shared-events] OK: non-discoverable target returns empty`
      );
    }

    // --- Scenario 6: private-invite excluded (covered in #1) ---
    console.log(
      `[smoke-shared-events] OK: private-invite excluded (covered in scenario 1)`
    );

    // --- Scenario 7: sensitive events → aggregate yes, named no (covered in #1) ---
    console.log(
      `[smoke-shared-events] OK: sensitive events aggregate yes, named no (covered in scenario 1)`
    );

    // --- Scenario 8: threshold boundary ---
    {
      const alice = await signIn("alice-shared");
      await admin
        .from("event_attendances")
        .delete()
        .eq("event_id", publicSmallId)
        .eq("user_id", bobId);

      const { data } = await alice.rpc("shared_events_for_viewer", {
        p_viewer_id: aliceId,
        p_target_id: bobId,
      });
      const row = (data ?? [])[0] as {
        event_count: number;
        named_events: unknown[];
      };
      if (row.event_count !== 3) {
        throw new Error(
          `after removing attendance: expected 3, got ${row.event_count}`
        );
      }
      await addAttendance(publicSmallId, bobId, adminId);
      console.log(
        `[smoke-shared-events] OK: removing one attendance drops event from result`
      );
    }

    // --- Scenario 10: rate limit exhaustion does not raise ---
    {
      const alice = await signIn("alice-shared");
      let lastResult: { event_count: number } | null = null;
      for (let i = 0; i < 31; i += 1) {
        const { data } = await alice.rpc("shared_events_for_viewer", {
          p_viewer_id: aliceId,
          p_target_id: bobId,
        });
        lastResult = (data ?? [])[0] as { event_count: number };
      }
      if (!lastResult) throw new Error(`rate limit: no last result`);
      console.log(
        `[smoke-shared-events] OK: rate limit exhaustion does not raise (final aggregate=${lastResult.event_count})`
      );
      await admin
        .from("rate_limit_hits")
        .delete()
        .eq("bucket", "shared_events_view")
        .eq("key", aliceId);
    }

    // --- Scenario 11: stale privacy version blocks share_counts flip ---
    {
      const staleId = await seedUser("stale-shared", { onboarded: false });
      await admin
        .from("profiles")
        .update({
          first_name: "Stale",
          last_name: "Shared",
          school: "Georgia State University",
          major: "CS",
          class_standing: "junior",
          grad_year: 2027,
          grad_term: "Spring 2027",
          interested_roles: ["software_engineering"],
        })
        .eq("id", staleId);
      await admin.from("resumes").insert({
        user_id: staleId,
        storage_path: `${staleId}/resume-stale.pdf`,
        file_name: "resume.pdf",
        file_size: 1024,
        mime_type: "application/pdf",
        status: "active",
        is_current: true,
      });
      for (const [t, v] of currentVersions) {
        const useVersion = t === "privacy_policy" ? "v0" : v;
        await admin.from("consents").insert({
          user_id: staleId,
          consent_type: t,
          accepted: true,
          version: useVersion,
        });
      }
      const staleClient = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      );
      await staleClient.auth.signInWithPassword({
        email: `stale-shared-${suffix}@example.com`,
        password,
      });
      const { error } = await staleClient.rpc("set_profile_visibility", {
        p_payload: { discoverable: true, share_shared_event_counts: true },
      });
      if (!error) throw new Error(`stale flip should have raised`);
      if (!/reaccept_privacy|not fully onboarded/i.test(error.message)) {
        throw new Error(`expected reaccept/onboarded, got: ${error.message}`);
      }
      console.log(
        `[smoke-shared-events] OK: stale privacy version blocks share_counts flip`
      );
    }

    // --- Scenario 12: share_counts requires discoverable ---
    {
      const onlyCountsId = await seedUser("only-counts", {});
      const c = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      );
      await c.auth.signInWithPassword({
        email: `only-counts-${suffix}@example.com`,
        password,
      });
      const { error } = await c.rpc("set_profile_visibility", {
        p_payload: { share_shared_event_counts: true },
      });
      if (!error) {
        throw new Error(`share_counts without discoverable should have raised`);
      }
      if (!/SHARED_EVENTS_REQUIRES_DISCOVERABLE/i.test(error.message)) {
        throw new Error(
          `expected SHARED_EVENTS_REQUIRES_DISCOVERABLE, got: ${error.message}`
        );
      }
      console.log(
        `[smoke-shared-events] OK: share_counts without discoverable raises friendly error`
      );
      void onlyCountsId;
    }

    // --- Scenario 14: audit metadata shape ---
    {
      const { data: auditRow } = await admin
        .from("audit_log")
        .select("metadata")
        .eq("action", "member.shared_events_view")
        .eq("actor_user_id", aliceId)
        .eq("target_user_id", bobId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      const meta = (auditRow as { metadata: Record<string, unknown> } | null)
        ?.metadata;
      if (!meta) throw new Error(`no audit row found`);
      if (typeof meta.aggregate_count !== "number") {
        throw new Error(`audit missing aggregate_count`);
      }
      if (typeof meta.named_event_count !== "number") {
        throw new Error(`audit missing named_event_count`);
      }
      console.log(
        `[smoke-shared-events] OK: audit metadata has aggregate_count=${meta.aggregate_count}, named_event_count=${meta.named_event_count}`
      );
    }

    console.log("[smoke-shared-events-visibility] ALL OK");
  } finally {
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    await admin
      .from("rate_limit_hits")
      .delete()
      .eq("bucket", "shared_events_view");
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-shared-events-visibility] FAILED:", err);
  process.exit(1);
});
