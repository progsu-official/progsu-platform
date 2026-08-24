#!/usr/bin/env tsx
// Smoke: admin_platform_analytics() — the numbers behind /admin Overview
// (20260824110000 + 20260824120000).
//
// What actually matters here:
//
//   * the gate. It is SECURITY DEFINER over the whole roster, so an
//     anonymous caller and a signed-in non-admin both have to be refused.
//   * the dense series. A signup chart is a lie if quiet weeks are dropped
//     instead of rendered as zero, so the weekly series must come back with
//     exactly p_weeks contiguous buckets ending on the current week — not
//     "one row per week that had a signup".
//   * the deltas. A new member has to move members.total and the current
//     week's bucket; a member who has not accepted the current consent
//     versions must not count as consents_current; an archived profile must
//     leave members.total.
//
// This runs against the shared database, so every assertion is a delta or a
// property of the caller's own seeded rows — never an absolute count that a
// real signup landing mid-run would break.

import { config } from "dotenv";
config({ path: ".env.local" });

type Analytics = {
  members: Record<string, number>;
  signups_weekly: Array<{ week: string; n: number }>;
  events: Record<string, number>;
  events_monthly: Array<{ month: string; events: number; attendance: number }>;
  top_events: Array<{ title: string; starts_at: string; head: number }>;
  class_standing: Array<{ key: string; n: number }>;
  roles: Array<{ key: string; n: number }>;
  schools: Array<{ key: string; n: number }>;
  legacy: { total: number; claimed: number };
  domain_requests: number;
  privacy_version: string | null;
  generated_at: string;
};

const DAY_MS = 24 * 3600 * 1000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
  const password = "analytics-platform-smoke-1234";
  const createdUserIds: string[] = [];

  // Read at startup, never hardcoded — see scripts/smoke-event-rsvp.ts.
  const { data: versionRows } = await admin
    .from("consent_versions")
    .select("consent_type, version");
  const currentVersions = new Map<string, string>(
    (versionRows ?? []).map((r) => [
      r.consent_type as string,
      r.version as string,
    ])
  );

  function anonClient() {
    return createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
  }

  async function seedUser(
    label: string,
    { isAdmin = false }: { isAdmin?: boolean } = {}
  ): Promise<string> {
    const email = `${label}-${suffix}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert(!error && data.user, `create ${label}: ${error?.message}`);
    const uid = data.user!.id;
    createdUserIds.push(uid);

    const { error: profileErr } = await admin
      .from("profiles")
      .update({
        first_name: label,
        last_name: "Smoke",
        school: "Georgia State University",
        major: "CS",
        phone_number: "555-555-5555",
        class_standing: "junior",
        grad_year: 2027,
        grad_term: "Spring 2027",
        interested_roles: ["software_engineering"],
        is_admin: isAdmin,
      })
      .eq("id", uid);
    assert(!profileErr, `profile ${label}: ${profileErr?.message}`);
    return uid;
  }

  async function acceptRequiredConsents(uid: string) {
    for (const type of [
      "privacy_policy",
      "terms_of_service",
      "age_confirmation",
    ]) {
      const version = currentVersions.get(type);
      assert(version, `no current version for ${type}`);
      const { error } = await admin.from("consents").insert({
        user_id: uid,
        consent_type: type,
        accepted: true,
        version,
      });
      assert(!error, `consent ${type}: ${error?.message}`);
    }
  }

  async function signIn(label: string) {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({
      email: `${label}-${suffix}@example.com`,
      password,
    });
    assert(!error, `sign in ${label}: ${error?.message}`);
    return client;
  }

  async function read(
    client: ReturnType<typeof anonClient>,
    args: { p_weeks?: number; p_months?: number } = {}
  ): Promise<Analytics> {
    const { data, error } = await client.rpc("admin_platform_analytics", args);
    assert(!error, `admin_platform_analytics: ${error?.message}`);
    return data as unknown as Analytics;
  }

  try {
    const adminId = await seedUser("plat-admin", { isAdmin: true });
    await acceptRequiredConsents(adminId);
    await seedUser("plat-member");

    // --- gate: anonymous and non-admin are both refused -------------------
    {
      const { error: anonErr } = await anonClient().rpc(
        "admin_platform_analytics",
        {}
      );
      assert(anonErr, "anonymous caller was allowed to read platform analytics");

      const member = await signIn("plat-member");
      const { error: memberErr } = await member.rpc(
        "admin_platform_analytics",
        {}
      );
      await member.auth.signOut();
      assert(memberErr, "non-admin member was allowed to read platform analytics");
      console.log(
        "[smoke-admin-platform-analytics] OK: anon and non-admin are both refused"
      );
    }

    const adminClient = await signIn("plat-admin");

    // --- shape ------------------------------------------------------------
    let before: Analytics;
    {
      before = await read(adminClient);
      for (const key of [
        "members",
        "signups_weekly",
        "events",
        "events_monthly",
        "top_events",
        "class_standing",
        "roles",
        "schools",
        "legacy",
        "generated_at",
      ]) {
        assert(
          (before as unknown as Record<string, unknown>)[key] !== undefined,
          `missing key: ${key}`
        );
      }
      for (const key of [
        "total",
        "verified",
        "unverified",
        "admins",
        "onboarded",
        "consents_current",
        "with_resume",
        "with_avatar",
        "with_links",
        "discoverable",
        "open_to_recruiters",
        "new_7d",
        "new_30d",
        "new_90d",
      ]) {
        assert(
          typeof before.members[key] === "number",
          `members.${key} is not a number`
        );
      }
      assert(before.members.total >= 2, "seeded members are missing from total");
      console.log("[smoke-admin-platform-analytics] OK: payload shape");
    }

    // --- the weekly series is dense, ordered, and ends on this week -------
    {
      const rows = before.signups_weekly;
      assert(rows.length === 26, `expected 26 weekly buckets, got ${rows.length}`);
      for (let i = 1; i < rows.length; i++) {
        const prev = Date.parse(`${rows[i - 1].week}T00:00:00Z`);
        const cur = Date.parse(`${rows[i].week}T00:00:00Z`);
        assert(
          cur - prev === 7 * DAY_MS,
          `weekly buckets not contiguous at ${rows[i - 1].week} -> ${rows[i].week}`
        );
      }
      // Every bucket exists even when nobody joined — that is the whole point
      // of generate_series here.
      assert(
        rows.some((r) => r.n === 0),
        "no empty week in 26 weeks — the series looks filtered, not dense"
      );
      console.log(
        "[smoke-admin-platform-analytics] OK: 26 contiguous weekly buckets, empty weeks included"
      );
    }

    // --- monthly series ---------------------------------------------------
    {
      const rows = before.events_monthly;
      assert(
        rows.length === 12,
        `expected 12 monthly buckets, got ${rows.length}`
      );
      for (let i = 1; i < rows.length; i++) {
        assert(rows[i].month > rows[i - 1].month, "monthly buckets out of order");
      }
      console.log("[smoke-admin-platform-analytics] OK: 12 ordered monthly buckets");
    }

    // --- p_weeks / p_months clamp ----------------------------------------
    {
      const tiny = await read(adminClient, { p_weeks: 1, p_months: 1 });
      assert(
        tiny.signups_weekly.length === 4 && tiny.events_monthly.length === 3,
        `floors not applied: ${tiny.signups_weekly.length} weeks, ${tiny.events_monthly.length} months`
      );
      const huge = await read(adminClient, { p_weeks: 9999, p_months: 9999 });
      assert(
        huge.signups_weekly.length === 104 && huge.events_monthly.length === 36,
        `ceilings not applied: ${huge.signups_weekly.length} weeks, ${huge.events_monthly.length} months`
      );
      console.log(
        "[smoke-admin-platform-analytics] OK: p_weeks/p_months clamp to [4,104] and [3,36]"
      );
    }

    // --- a new member moves total and this week's bucket ------------------
    {
      const lastWeekBefore =
        before.signups_weekly[before.signups_weekly.length - 1].n;
      const newId = await seedUser("plat-fresh");

      const after = await read(adminClient);
      assert(
        after.members.total >= before.members.total + 1,
        `members.total did not grow: ${before.members.total} -> ${after.members.total}`
      );
      const lastWeekAfter =
        after.signups_weekly[after.signups_weekly.length - 1].n;
      assert(
        lastWeekAfter >= lastWeekBefore + 1,
        `current week bucket did not grow: ${lastWeekBefore} -> ${lastWeekAfter}`
      );
      assert(after.members.new_7d >= 1, "new_7d did not count a signup made now");

      // --- consents: not current until all three are accepted -------------
      const consentsBefore = after.members.consents_current;
      await acceptRequiredConsents(newId);
      const consented = await read(adminClient);
      assert(
        consented.members.consents_current >= consentsBefore + 1,
        `consents_current did not grow after accepting: ${consentsBefore} -> ${consented.members.consents_current}`
      );
      console.log(
        "[smoke-admin-platform-analytics] OK: new member counted, consents_current tracks acceptance"
      );

      // --- archived profiles leave the active roster ----------------------
      const activeBefore = consented.members.total;
      const archivedBefore = consented.members.archived;
      const { error: archiveErr } = await admin
        .from("profiles")
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq("id", newId);
      assert(!archiveErr, `archive: ${archiveErr?.message}`);

      const archived = await read(adminClient);
      assert(
        archived.members.total <= activeBefore - 1,
        `archived member still in members.total: ${activeBefore} -> ${archived.members.total}`
      );
      assert(
        archived.members.archived >= archivedBefore + 1,
        "members.archived did not grow"
      );
      console.log(
        "[smoke-admin-platform-analytics] OK: archived profiles leave the active roster"
      );
    }

    await adminClient.auth.signOut();
    console.log("[smoke-admin-platform-analytics] ALL OK");
  } finally {
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-admin-platform-analytics] FAILED:", err);
  process.exit(1);
});
