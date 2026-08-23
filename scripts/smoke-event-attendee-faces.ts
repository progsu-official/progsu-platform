#!/usr/bin/env tsx
// Smoke: event_attendee_faces() — the attendee stack behind the event page's
// social proof (20260823100000).
//
// The interesting assertions are all about what stays OUT of `faces`:
//
//   * a member with discoverable = false is counted, never named
//   * guest RSVPs are counted, never named (they have no profile at all)
//   * imported historical attendees are counted; only the ones who have since
//     claimed a discoverable profile get a face
//   * a private_invite event returns (0, '[]') to a member who was not
//     invited — empty, not an error, so a hidden event stays indistinguishable
//     from an empty one
//   * an anonymous caller gets faces on a published/members event and nothing
//     on a draft
//
// Consent versions are read from the DB, never hardcoded — see
// scripts/smoke-event-rsvp.ts for why.

import { config } from "dotenv";
config({ path: ".env.local" });

type FacesRow = {
  total_count: number;
  faces: Array<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    profile_slug: string | null;
  }>;
};

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
  const password = "faces-smoke-1234";
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdLegacyIds: string[] = [];

  async function seedUser(
    label: string,
    { discoverable }: { discoverable: boolean }
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

    const { error: profileErr } = await admin
      .from("profiles")
      .update({
        first_name: label,
        last_name: "Smoke",
        phone_number: "555-555-5555",
        school: "Georgia State University",
        major: "CS",
        class_standing: "junior",
        grad_year: 2027,
        grad_term: "Spring 2027",
        interested_roles: ["software_engineering"],
        avatar_url: `https://example.com/${label}.png`,
      })
      .eq("id", uid);
    if (profileErr) throw new Error(`profile ${label}: ${profileErr.message}`);

    const { data: versions } = await admin
      .from("consent_versions")
      .select("consent_type, version");
    for (const v of versions ?? []) {
      await admin.from("consents").insert({
        user_id: uid,
        consent_type: (v as { consent_type: string }).consent_type,
        accepted: true,
        version: (v as { version: string }).version,
      });
    }

    const userClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
    await userClient.auth.signInWithPassword({ email, password });
    const { error: visErr } = await userClient.rpc("set_profile_visibility", {
      p_payload: { discoverable },
    });
    if (visErr) throw new Error(`visibility ${label}: ${visErr.message}`);
    await userClient.auth.signOut();

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

  function anonClient() {
    return createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
  }

  async function seedEvent(
    label: string,
    {
      status = "published",
      visibility = "members",
    }: { status?: string; visibility?: string } = {}
  ): Promise<string> {
    const starts = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const ends = new Date(starts.getTime() + 2 * 3600 * 1000);
    const { data, error } = await admin
      .from("events")
      .insert({
        slug: `${label}-${suffix}`,
        title: `${label} smoke event`,
        status,
        visibility,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`event ${label}: ${error?.message}`);
    const id = (data as { id: string }).id;
    createdEventIds.push(id);
    return id;
  }

  async function faces(
    client: ReturnType<typeof anonClient>,
    eventId: string
  ): Promise<FacesRow> {
    const { data, error } = await client
      .rpc("event_attendee_faces", { p_event_id: eventId, p_limit: 12 })
      .maybeSingle();
    if (error) throw new Error(`event_attendee_faces: ${error.message}`);
    const row = data as FacesRow | null;
    return row ?? { total_count: 0, faces: [] };
  }

  try {
    const visibleId = await seedUser("faces-visible", { discoverable: true });
    const hiddenId = await seedUser("faces-hidden", { discoverable: false });
    const outsiderId = await seedUser("faces-outsider", { discoverable: true });

    const eventId = await seedEvent("faces-open");

    // Both RSVP through the real write path so waitlist/capacity bookkeeping
    // matches production rows.
    for (const label of ["faces-visible", "faces-hidden"]) {
      const c = await signIn(label);
      const { error } = await c.rpc("rsvp_to_event", {
        p_event_id: eventId,
        p_desired: "going",
      });
      if (error) throw new Error(`rsvp ${label}: ${error.message}`);
      await c.auth.signOut();
    }

    // --- discoverable member is named, opted-out member is only counted ---
    {
      const c = await signIn("faces-visible");
      const r = await faces(c, eventId);
      await c.auth.signOut();

      if (r.total_count !== 2) {
        throw new Error(`expected total 2, got ${r.total_count}`);
      }
      const ids = new Set(r.faces.map((f) => f.user_id));
      if (!ids.has(visibleId)) throw new Error("discoverable member missing from faces");
      if (ids.has(hiddenId)) {
        throw new Error("opted-out member leaked into faces");
      }
      console.log(
        "[smoke-event-attendee-faces] OK: opted-out member counted (2) but not named (1 face)"
      );
    }

    // --- guest RSVPs count toward the total, never appear as faces --------
    {
      const { error } = await anonClient().rpc("guest_rsvp_to_event", {
        p_event_id: eventId,
        p_name: "Guest Smoke",
        p_email: `guest-${suffix}@example.com`,
        p_phone: "555-555-5555",
      });
      if (error) throw new Error(`guest_rsvp_to_event: ${error.message}`);

      const r = await faces(anonClient(), eventId);
      if (r.total_count !== 3) {
        throw new Error(`expected total 3 after guest, got ${r.total_count}`);
      }
      if (r.faces.length !== 1) {
        throw new Error(`guest should not add a face, got ${r.faces.length}`);
      }
      console.log(
        "[smoke-event-attendee-faces] OK: guest RSVP counted, never named"
      );
    }

    // --- historical attendance: counted; only claimed+discoverable named --
    {
      const claimed = await admin
        .from("legacy_members")
        .insert({
          full_name: "Claimed Legacy",
          first_name: "Claimed",
          last_name: "Legacy",
          personal_email: `legacy-claimed-${suffix}@example.com`,
          source: "luma_export",
          claimed_profile_id: outsiderId,
          claimed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (claimed.error) throw new Error(`legacy claimed: ${claimed.error.message}`);
      const claimedId = (claimed.data as { id: string }).id;
      createdLegacyIds.push(claimedId);

      const unclaimed = await admin
        .from("legacy_members")
        .insert({
          full_name: "Unclaimed Legacy",
          first_name: "Unclaimed",
          last_name: "Legacy",
          personal_email: `legacy-unclaimed-${suffix}@example.com`,
          source: "luma_export",
        })
        .select("id")
        .single();
      if (unclaimed.error) throw new Error(`legacy unclaimed: ${unclaimed.error.message}`);
      const unclaimedId = (unclaimed.data as { id: string }).id;
      createdLegacyIds.push(unclaimedId);

      for (const lmId of [claimedId, unclaimedId]) {
        const { error } = await admin.from("historical_event_attendances").insert({
          event_id: eventId,
          legacy_member_id: lmId,
          approval_status: "approved",
          registered_at: new Date().toISOString(),
        });
        if (error) throw new Error(`historical insert: ${error.message}`);
      }

      const r = await faces(anonClient(), eventId);
      if (r.total_count !== 5) {
        throw new Error(`expected total 5 with historical, got ${r.total_count}`);
      }
      const ids = new Set(r.faces.map((f) => f.user_id));
      if (!ids.has(outsiderId)) {
        throw new Error("claimed historical attendee missing from faces");
      }
      if (r.faces.length !== 2) {
        throw new Error(
          `expected 2 faces (visible + claimed legacy), got ${r.faces.length}`
        );
      }
      console.log(
        "[smoke-event-attendee-faces] OK: historical counted (5), only the claimed profile named (2 faces)"
      );
    }

    // --- anonymous caller: published/members yes, draft no ----------------
    {
      const r = await faces(anonClient(), eventId);
      if (r.faces.length === 0) {
        throw new Error("anon got no faces on a published members event");
      }

      const draftId = await seedEvent("faces-draft", { status: "draft" });
      const d = await faces(anonClient(), draftId);
      if (d.total_count !== 0 || d.faces.length !== 0) {
        throw new Error(
          `draft leaked to anon: total=${d.total_count} faces=${d.faces.length}`
        );
      }
      console.log(
        "[smoke-event-attendee-faces] OK: anon reads published, gets empty on draft"
      );
    }

    // --- private_invite: empty for a non-invited member, not an error -----
    {
      const privateId = await seedEvent("faces-private", {
        visibility: "private_invite",
      });
      const { error: inviteErr } = await admin.from("event_rsvps").insert({
        event_id: privateId,
        user_id: visibleId,
        status: "going",
      });
      if (inviteErr) throw new Error(`seed private rsvp: ${inviteErr.message}`);

      const c = await signIn("faces-outsider");
      const r = await faces(c, privateId);
      await c.auth.signOut();

      if (r.total_count !== 0 || r.faces.length !== 0) {
        throw new Error(
          `private_invite leaked: total=${r.total_count} faces=${r.faces.length}`
        );
      }
      console.log(
        "[smoke-event-attendee-faces] OK: private_invite returns empty (not an error) to a non-invited member"
      );
    }

    // --- cancelled RSVPs drop out of the count ----------------------------
    {
      const c = await signIn("faces-hidden");
      const { error } = await c.rpc("rsvp_to_event", {
        p_event_id: eventId,
        p_desired: "cancelled",
      });
      if (error) throw new Error(`cancel rsvp: ${error.message}`);
      await c.auth.signOut();

      const r = await faces(anonClient(), eventId);
      if (r.total_count !== 4) {
        throw new Error(`expected total 4 after cancel, got ${r.total_count}`);
      }
      console.log(
        "[smoke-event-attendee-faces] OK: cancelled RSVP drops out of the total"
      );
    }

    console.log("[smoke-event-attendee-faces] ALL OK");
  } finally {
    for (const id of createdLegacyIds) {
      await admin.from("legacy_members").delete().eq("id", id).then(
        () => {},
        () => {}
      );
    }
    for (const id of createdEventIds) {
      await admin.from("events").delete().eq("id", id).then(
        () => {},
        () => {}
      );
    }
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("[smoke-event-attendee-faces] FAILED:", err);
  process.exit(1);
});
