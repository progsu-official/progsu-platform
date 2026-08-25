#!/usr/bin/env tsx
// Smoke: referral links (migration 20260824150000).
//
// What actually matters here:
//
//   * the access model. Every table is RLS-on with zero policies and every
//     function is SECURITY DEFINER, so the interesting assertions are the
//     refusals: anon and non-admin cannot read or write the tables directly,
//     cannot mint links, and cannot reach the hit recorders at all. Those
//     recorders take no caller identity, so "a browser cannot call them" is
//     the entire anti-abuse story and it has to be true.
//
//   * the privacy shape. referral_link_hits must have no column that could
//     identify a person. This asserts the exact column set against a real row
//     read on the service-role client, so a future migration adding a user_id
//     "just for debugging" fails here rather than shipping.
//
//   * the counting rules. Clicks distinguish new visitors from refreshes;
//     conversions refuse 'click' so a bad call site cannot inflate the top of
//     the funnel; archived links stop resolving but still take conversions;
//     an unpublished event never resolves.
//
// Runs against the shared database. Everything it asserts is about rows it
// seeded itself, and the finally block removes them.

import { config } from "dotenv";
config({ path: ".env.local" });

type LinkRow = {
  id: string;
  slug: string;
  label: string;
  archived_at: string | null;
  clicks: number;
  visitors: number;
  rsvps: number;
  signups: number;
  last_hit_at: string | null;
};

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
  const password = "referral-links-smoke-1234";
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  function anonClient() {
    return createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
  }

  async function seedUser(label: string, isAdmin: boolean): Promise<string> {
    const email = `${label}-${suffix}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert(!error && data.user, `create ${label}: ${error?.message}`);
    const uid = data.user!.id;
    createdUserIds.push(uid);
    const { error: pErr } = await admin
      .from("profiles")
      .update({ first_name: label, last_name: "Smoke", is_admin: isAdmin })
      .eq("id", uid);
    assert(!pErr, `profile ${label}: ${pErr?.message}`);
    return uid;
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

  async function seedEvent(
    title: string,
    status: "published" | "draft"
  ): Promise<string> {
    const starts = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const { data, error } = await admin
      .from("events")
      .insert({
        title,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 2 * 3600 * 1000).toISOString(),
        status,
        visibility: "members",
      })
      .select("id")
      .single();
    assert(!error && data, `seed event ${title}: ${error?.message}`);
    createdEventIds.push(data!.id as string);
    return data!.id as string;
  }

  try {
    const adminUid = await seedUser("refadmin", true);
    const memberUid = await seedUser("refmember", false);
    void adminUid;
    void memberUid;

    const eventId = await seedEvent("Referral Smoke Event", "published");
    const draftEventId = await seedEvent("Referral Smoke Draft", "draft");

    const adminClient = await signIn("refadmin");
    const memberClient = await signIn("refmember");
    const anon = anonClient();

    // -----------------------------------------------------------------
    // Direct table access is denied for anon and members
    // -----------------------------------------------------------------
    for (const [who, client] of [
      ["anon", anon],
      ["member", memberClient],
    ] as const) {
      for (const table of ["referral_links", "referral_link_hits"] as const) {
        const { data, error } = await client.from(table).select("*").limit(1);
        // RLS with no policies returns an empty set rather than an error for
        // selects; either shape is a pass, a row is not.
        assert(
          error !== null || (data ?? []).length === 0,
          `${who} could read ${table}`
        );
      }
      const { error: wErr } = await client
        .from("referral_links")
        .insert({ event_id: eventId, slug: `x-${suffix}`, label: "nope" });
      assert(wErr, `${who} could insert into referral_links`);
    }
    console.log("[smoke-referral-links] OK: direct table access denied");

    // -----------------------------------------------------------------
    // Minting: admin only
    // -----------------------------------------------------------------
    for (const [who, client] of [
      ["anon", anon],
      ["member", memberClient],
    ] as const) {
      const { error } = await client.rpc("create_referral_link", {
        p_event_id: eventId,
        p_slug: null,
        p_label: "should not work",
      });
      assert(error, `${who} could create a referral link`);
    }

    // Hit recorders are service_role only — not reachable at all.
    for (const [who, client] of [
      ["anon", anon],
      ["member", memberClient],
    ] as const) {
      const { error: cErr } = await client.rpc("record_referral_click", {
        p_slug: "whatever",
        p_is_new_visitor: true,
      });
      assert(cErr, `${who} could call record_referral_click`);
      const { error: vErr } = await client.rpc("record_referral_conversion", {
        p_slug: "whatever",
        p_kind: "rsvp",
      });
      assert(vErr, `${who} could call record_referral_conversion`);
    }
    console.log(
      "[smoke-referral-links] OK: minting is admin-only, recording is service-role-only"
    );

    // -----------------------------------------------------------------
    // Random slug, custom slug, and the rules around them
    // -----------------------------------------------------------------
    const { data: randomRow, error: randomErr } = await adminClient.rpc(
      "create_referral_link",
      { p_event_id: eventId, p_slug: null, p_label: "Library flyer" }
    );
    assert(!randomErr && randomRow, `random slug: ${randomErr?.message}`);
    const randomSlug = (randomRow as { slug: string }).slug;
    assert(
      /^[a-z0-9]{7}$/.test(randomSlug),
      `random slug shape: ${randomSlug}`
    );
    assert(
      !/[ilo01]/.test(randomSlug),
      `random slug used a misread-prone character: ${randomSlug}`
    );

    const customSlug = `smoke-flyer-${suffix}`;
    const { error: customErr } = await adminClient.rpc("create_referral_link", {
      p_event_id: eventId,
      p_slug: customSlug,
      p_label: "Discord post",
    });
    assert(!customErr, `custom slug: ${customErr?.message}`);

    // Collision raises rather than silently suffixing — the admin typed that
    // exact string onto a flyer.
    const { error: dupErr } = await adminClient.rpc("create_referral_link", {
      p_event_id: eventId,
      p_slug: customSlug,
      p_label: "Duplicate",
    });
    assert(dupErr, "duplicate slug was accepted");

    for (const bad of [
      "ab",
      "-leading",
      "trailing-",
      "has space",
      "under_score",
    ]) {
      const { error } = await adminClient.rpc("create_referral_link", {
        p_event_id: eventId,
        p_slug: bad,
        p_label: "bad slug",
      });
      assert(error, `malformed slug accepted: ${bad}`);
    }

    // Case and surrounding whitespace are normalised rather than rejected: the
    // officer typing "Library-Flyer" into the box means the same link as
    // "library-flyer", and an error there is just a rule for its own sake.
    const { data: casedRow, error: casedErr } = await adminClient.rpc(
      "create_referral_link",
      {
        p_event_id: eventId,
        p_slug: `  Mixed-CASE-${suffix}  `,
        p_label: "Mixed case",
      }
    );
    assert(!casedErr, `mixed-case slug rejected: ${casedErr?.message}`);
    assert(
      (casedRow as { slug: string }).slug === `mixed-case-${suffix}`,
      `mixed-case slug not normalised: ${(casedRow as { slug: string }).slug}`
    );

    const { error: labelErr } = await adminClient.rpc("create_referral_link", {
      p_event_id: eventId,
      p_slug: null,
      p_label: "   ",
    });
    assert(labelErr, "blank label accepted");
    console.log("[smoke-referral-links] OK: slug minting and validation");

    // -----------------------------------------------------------------
    // Clicks: resolution, visitor vs refresh, and what must not resolve
    // -----------------------------------------------------------------
    const { data: hit1 } = await admin.rpc("record_referral_click", {
      p_slug: customSlug,
      p_is_new_visitor: true,
    });
    const row1 = Array.isArray(hit1) ? hit1[0] : null;
    assert(row1?.event_slug, "click did not resolve to an event slug");

    await admin.rpc("record_referral_click", {
      p_slug: customSlug,
      p_is_new_visitor: false,
    });
    await admin.rpc("record_referral_click", {
      p_slug: customSlug,
      p_is_new_visitor: true,
    });

    const { data: unknownHit } = await admin.rpc("record_referral_click", {
      p_slug: `no-such-link-${suffix}`,
      p_is_new_visitor: true,
    });
    assert(
      (unknownHit ?? []).length === 0,
      "an unknown slug resolved to something"
    );

    // A link on a draft event must not resolve — otherwise a campaign started
    // early leaks an unpublished event's page.
    const draftSlug = `smoke-draft-${suffix}`;
    await adminClient.rpc("create_referral_link", {
      p_event_id: draftEventId,
      p_slug: draftSlug,
      p_label: "Draft link",
    });
    const { data: draftHit } = await admin.rpc("record_referral_click", {
      p_slug: draftSlug,
      p_is_new_visitor: true,
    });
    assert(
      (draftHit ?? []).length === 0,
      "a link on a draft event resolved"
    );
    console.log("[smoke-referral-links] OK: click resolution and gating");

    // -----------------------------------------------------------------
    // The privacy shape, asserted structurally
    // -----------------------------------------------------------------
    // The entire design rests on referral_link_hits being unable to say who
    // anyone is. Asserting it against a real row means a future migration that
    // adds a user_id "just for debugging" fails here rather than shipping. The
    // service-role client bypasses RLS, so this sees every column there is.
    {
      const { data: hitRows, error: hitErr } = await admin
        .from("referral_link_hits")
        .select("*")
        .limit(1);
      assert(!hitErr, `hits select: ${hitErr?.message}`);
      assert((hitRows ?? []).length === 1, "expected a recorded hit to inspect");

      const columns = Object.keys(hitRows![0]).sort();
      const expected = [
        "id",
        "is_new_visitor",
        "kind",
        "link_id",
        "occurred_at",
      ];
      assert(
        JSON.stringify(columns) === JSON.stringify(expected),
        `referral_link_hits columns changed: ${columns.join(", ")}. ` +
          "Read the header of migration 20260824150000 before adding one — " +
          "this table must never be able to identify a person."
      );
    }
    console.log("[smoke-referral-links] OK: hits table holds no identity");

    // -----------------------------------------------------------------
    // Conversions
    // -----------------------------------------------------------------
    const { data: rsvpOk } = await admin.rpc("record_referral_conversion", {
      p_slug: customSlug,
      p_kind: "rsvp",
    });
    assert(rsvpOk === true, "rsvp conversion not recorded");

    const { data: signupOk } = await admin.rpc("record_referral_conversion", {
      p_slug: customSlug,
      p_kind: "signup",
    });
    assert(signupOk === true, "signup conversion not recorded");

    const { error: clickKindErr } = await admin.rpc(
      "record_referral_conversion",
      { p_slug: customSlug, p_kind: "click" }
    );
    assert(
      clickKindErr,
      "record_referral_conversion accepted 'click' — clicks must only come from the redirect"
    );

    const { data: missingOk } = await admin.rpc("record_referral_conversion", {
      p_slug: `no-such-link-${suffix}`,
      p_kind: "rsvp",
    });
    assert(missingOk === false, "conversion on an unknown slug did not return false");
    console.log("[smoke-referral-links] OK: conversion rules");

    // -----------------------------------------------------------------
    // The admin read
    // -----------------------------------------------------------------
    for (const [who, client] of [
      ["anon", anon],
      ["member", memberClient],
    ] as const) {
      const { error } = await client.rpc("admin_referral_links_for", {
        p_event_id: eventId,
      });
      assert(error, `${who} could read admin_referral_links_for`);
    }

    const { data: payload, error: readErr } = await adminClient.rpc(
      "admin_referral_links_for",
      { p_event_id: eventId }
    );
    assert(!readErr && payload, `admin read: ${readErr?.message}`);
    const links = (payload as { links: LinkRow[] }).links;
    assert(Array.isArray(links) && links.length >= 2, "expected at least two links");

    const flyer = links.find((l) => l.slug === customSlug);
    assert(flyer, "custom link missing from the admin read");
    assert(flyer!.clicks === 3, `clicks: expected 3, got ${flyer!.clicks}`);
    assert(flyer!.visitors === 2, `visitors: expected 2, got ${flyer!.visitors}`);
    assert(flyer!.rsvps === 1, `rsvps: expected 1, got ${flyer!.rsvps}`);
    assert(flyer!.signups === 1, `signups: expected 1, got ${flyer!.signups}`);
    assert(flyer!.last_hit_at, "last_hit_at not set");

    // Only this event's links — a campaign for one event must not show up in
    // another's tab.
    assert(
      links.every((l) => l.slug !== draftSlug),
      "a link from another event leaked into this event's read"
    );
    console.log("[smoke-referral-links] OK: admin read is scoped and counted");

    // -----------------------------------------------------------------
    // Archiving
    // -----------------------------------------------------------------
    const { error: archErr } = await adminClient.rpc("archive_referral_link", {
      p_id: flyer!.id,
      p_archived: true,
    });
    assert(!archErr, `archive: ${archErr?.message}`);

    const { data: archivedHit } = await admin.rpc("record_referral_click", {
      p_slug: customSlug,
      p_is_new_visitor: true,
    });
    assert(
      (archivedHit ?? []).length === 0,
      "an archived link still resolved"
    );

    // Conversions still land: someone who clicked before it was archived and
    // RSVPs after belongs to the campaign that brought them.
    const { data: lateRsvp } = await admin.rpc("record_referral_conversion", {
      p_slug: customSlug,
      p_kind: "rsvp",
    });
    assert(lateRsvp === true, "archived link refused a late conversion");

    const { error: restoreErr } = await adminClient.rpc("archive_referral_link", {
      p_id: flyer!.id,
      p_archived: false,
    });
    assert(!restoreErr, `restore: ${restoreErr?.message}`);
    const { data: restoredHit } = await admin.rpc("record_referral_click", {
      p_slug: customSlug,
      p_is_new_visitor: true,
    });
    assert(
      (restoredHit ?? []).length === 1,
      "a restored link did not resolve again"
    );

    for (const [who, client] of [
      ["anon", anon],
      ["member", memberClient],
    ] as const) {
      const { error } = await client.rpc("archive_referral_link", {
        p_id: flyer!.id,
        p_archived: true,
      });
      assert(error, `${who} could archive a link`);
    }
    console.log("[smoke-referral-links] OK: archive stops clicks, keeps conversions");

    await adminClient.auth.signOut();
    await memberClient.auth.signOut();
    console.log("[smoke-referral-links] ALL OK");
  } finally {
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id);
    }
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-referral-links] FAILED:", err);
  process.exit(1);
});
