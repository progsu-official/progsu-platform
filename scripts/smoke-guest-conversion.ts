#!/usr/bin/env tsx
// Smoke: guest → member conversion (docs/16-guest-conversion).
//
//   1. guest_rsvp_to_event returns (status, claim_token) and always mints a
//      claim token, waitlisted rows included.
//   2. It refuses to create a guest identity when the email already belongs to
//      a member, and when the PHONE does — including when the two are written
//      in different formats, which is the whole point of phone_e164.
//   3. A refused RSVP writes nothing. A collision must not leave a half-made
//      guest row behind.
//   4. SMS opt-in stores the disclosure verbatim alongside the timestamp, and
//      an un-ticked box on a later RSVP never withdraws an earlier consent
//      (withdrawal is STOP, which lands in sms_suppressions).
//   5. guest_claim_context is anon-readable for a held token and an empty set
//      for an unknown one — never an error, same posture as the ticket page.
//   6. A school email is staged as campus_email, and claim_guest_identity
//      links it to an account created with a DIFFERENT (Google) address —
//      the case plain email matching cannot solve.
//   7. handle_new_user copies those answers onto the fresh profile at first
//      Google login and stamps claimed_at / claimed_profile_id.
//   8. sms_suppressions is closed to clients and its writer is idempotent.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

let failures = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail === undefined ? "" : detail);
  }
}

async function main() {
  const { env, requireServerEnv } = await import("../lib/env");
  const { createClient } = await import("@supabase/supabase-js");
  const { SMS_CONSENT_COPY } = await import("../lib/actions/event-schemas");
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

  const admin = createClient(url, SUPABASE_SERVICE_ROLE_KEY, noSession);
  const anon = createClient(url, anonKey, noSession);

  const suffix = Date.now().toString(36);
  const adminEmail = `smoke-conv-admin-${suffix}@example.com`;
  const memberEmail = `smoke-conv-member-${suffix}@example.com`;
  const guestEmail = `smoke-conv-guest-${suffix}@example.com`;
  const claimEmail = `smoke-conv-claim-${suffix}@example.com`;
  const googleEmail = `smoke-conv-google-${suffix}@example.com`;
  const password = "testpassword-12345";
  const slug = `smoke-guest-conversion-${suffix}`;

  // Same human number written three ways. The member profile stores one form,
  // the colliding guest submits another.
  const memberPhoneStored = "(404) 555-0142";
  const memberPhoneTyped = "4045550142";
  const guestPhone = "201 555 0188";

  let adminId: string | null = null;
  let memberId: string | null = null;
  let claimedId: string | null = null;
  let googleId: string | null = null;
  let eventId: string | null = null;

  try {
    const { data: au, error: auErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (auErr || !au.user) throw new Error(`create admin: ${auErr?.message}`);
    adminId = au.user.id;
    await admin.from("profiles").update({ is_admin: true }).eq("id", adminId);

    const { data: mu, error: muErr } = await admin.auth.admin.createUser({
      email: memberEmail,
      password,
      email_confirm: true,
    });
    if (muErr || !mu.user) throw new Error(`create member: ${muErr?.message}`);
    memberId = mu.user.id;
    await admin
      .from("profiles")
      .update({ phone_number: memberPhoneStored })
      .eq("id", memberId);

    // --- 0. the generated column normalizes ------------------------------
    const { data: mProfile } = await admin
      .from("profiles")
      .select("phone_e164")
      .eq("id", memberId)
      .single();
    check(
      "phone_e164 generated from free-text phone_number",
      (mProfile as { phone_e164: string | null })?.phone_e164 === "+14045550142",
      mProfile
    );

    const starts = new Date(Date.now() + 30 * 60_000);
    const ends = new Date(Date.now() + 120 * 60_000);
    const { data: ev, error: evErr } = await admin
      .from("events")
      .insert({
        slug,
        title: "Guest Conversion Smoke",
        status: "published",
        visibility: "members",
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        location_text: "Unity Plaza, Atlanta",
        created_by: adminId,
        updated_by: adminId,
        published_at: new Date().toISOString(),
        send_rsvp_email: false,
      })
      .select("id")
      .single();
    if (evErr || !ev) throw new Error(`insert event: ${evErr?.message}`);
    eventId = (ev as { id: string }).id;

    // --- 1. collision on email -------------------------------------------
    const { error: emailCollide } = await anon.rpc("guest_rsvp_to_event", {
      p_event_id: eventId,
      p_name: "Impostor Member",
      p_email: memberEmail,
      p_phone: guestPhone,
    });
    check(
      "guest RSVP refused when email belongs to a member",
      !!emailCollide && /account exists/i.test(emailCollide.message),
      emailCollide?.message
    );

    // --- 2. collision on phone, different formatting ----------------------
    const { error: phoneCollide } = await anon.rpc("guest_rsvp_to_event", {
      p_event_id: eventId,
      p_name: "Same Human",
      p_email: `different-${suffix}@example.com`,
      p_phone: memberPhoneTyped,
    });
    check(
      "guest RSVP refused when phone matches a member in another format",
      !!phoneCollide && /account exists/i.test(phoneCollide.message),
      phoneCollide?.message
    );

    // --- 3. a refused RSVP leaves nothing behind --------------------------
    const { count: afterCollisions } = await admin
      .from("event_guest_rsvps")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);
    check("collisions wrote no guest rows", afterCollisions === 0, afterCollisions);

    // --- 4. a real guest RSVP, with SMS opt-in ----------------------------
    const { data: rsvp, error: rsvpErr } = await anon.rpc(
      "guest_rsvp_to_event",
      {
        p_event_id: eventId,
        p_name: "Ada Guest",
        p_email: guestEmail,
        p_phone: guestPhone,
        p_sms_opt_in: true,
        p_sms_consent_copy: SMS_CONSENT_COPY,
      }
    );
    if (rsvpErr) throw new Error(`guest_rsvp_to_event: ${rsvpErr.message}`);
    const row = (rsvp as Array<Record<string, unknown>>)[0];
    check("guest RSVP returns a row, not a scalar", !!row, rsvp);
    check("status is 'going'", row?.status === "going", row?.status);
    const claimToken = row?.claim_token as string | undefined;
    check("claim_token returned", !!claimToken);
    if (!claimToken) throw new Error("no claim token; cannot continue");

    const { data: lm1 } = await admin
      .from("legacy_members")
      .select("first_name, last_name, source, phone_e164, sms_consent_at, sms_consent_copy, answered_at")
      .eq("personal_email", guestEmail)
      .single();
    const staged = lm1 as Record<string, unknown> | null;
    check("guest identity staged in legacy_members", !!staged);
    check("source marks it as a guest RSVP", staged?.source === "guest_rsvp");
    check("name split into first/last", staged?.first_name === "Ada" && staged?.last_name === "Guest");
    check("phone normalized on the staging row", staged?.phone_e164 === "+12015550188");
    check("sms consent timestamped", !!staged?.sms_consent_at);
    check(
      "sms consent stores the exact disclosure shown",
      staged?.sms_consent_copy === SMS_CONSENT_COPY,
      staged?.sms_consent_copy
    );
    check("not yet marked answered", staged?.answered_at === null);

    // --- 4b. re-RSVP with the box unticked must not withdraw consent -----
    await anon.rpc("guest_rsvp_to_event", {
      p_event_id: eventId,
      p_name: "Ada Guest",
      p_email: guestEmail,
      p_phone: guestPhone,
      p_sms_opt_in: false,
      p_sms_consent_copy: null,
    });
    const { data: lm2 } = await admin
      .from("legacy_members")
      .select("sms_consent_at")
      .eq("personal_email", guestEmail)
      .single();
    check(
      "an unticked box does not withdraw an earlier SMS consent",
      !!(lm2 as { sms_consent_at: string | null })?.sms_consent_at
    );

    // --- 4c. the transitional 4-arg shim (20260823150700) -----------------
    // Already-deployed builds call this form and expect a bare status string.
    // Delete this block when the shim goes.
    const { data: legacyShape, error: legacyErr } = await anon.rpc(
      "guest_rsvp_to_event",
      {
        p_event_id: eventId,
        p_name: "Ada Guest",
        p_email: guestEmail,
        p_phone: guestPhone,
      }
    );
    check("4-arg shim resolves without ambiguity", !legacyErr, legacyErr?.message);
    check(
      "4-arg shim returns a scalar status, as pre-welcome builds expect",
      legacyShape === "going",
      legacyShape
    );

    // --- 5. anon claim context --------------------------------------------
    const { data: ctx, error: ctxErr } = await anon
      .rpc("guest_claim_context", { p_token: claimToken })
      .maybeSingle();
    check("guest_claim_context readable by anon", !ctxErr, ctxErr?.message);
    const context = ctx as Record<string, unknown> | null;
    check("context carries the holder's first name", context?.first_name === "Ada");
    check("context carries the event slug", context?.event_slug === slug);
    check("context reports not-yet-answered", context?.answered === false);
    check("context reports the SMS opt-in", context?.sms_opted_in === true);

    const { data: unknownCtx, error: unknownErr } = await anon
      .rpc("guest_claim_context", {
        p_token: "00000000-0000-0000-0000-000000000000",
      })
      .maybeSingle();
    check(
      "unknown claim token is an empty set, not an error",
      unknownCtx === null && !unknownErr,
      unknownErr?.message
    );

    // --- 5b. the major list is reachable with no session ------------------
    const { data: majors, error: majorsErr } = await anon
      .from("majors")
      .select("slug")
      .eq("is_active", true)
      .limit(1);
    check(
      "anon can read the active major list for the /welcome dropdown",
      !majorsErr && (majors ?? []).length === 1,
      majorsErr?.message
    );
    const majorSlug = (majors as Array<{ slug: string }> | null)?.[0]?.slug;

    // --- 6. school email routing + claim by token ------------------------
    // A .edu on an allowlisted domain goes to campus_email so it does not
    // occupy personal_email, which Google's address will want later.
    const eduEmail = `smoke-conv-edu-${suffix}@student.gsu.edu`;
    const { data: eduRsvp } = await anon.rpc("guest_rsvp_to_event", {
      p_event_id: eventId,
      p_name: "Edu Guest",
      p_email: eduEmail,
      p_phone: "678 555 0177",
      p_sms_opt_in: false,
      p_sms_consent_copy: null,
    });
    const eduToken = (eduRsvp as Array<{ claim_token: string }>)?.[0]?.claim_token;
    check("school-email guest RSVP accepted", !!eduToken);

    const { data: eduStaged } = await admin
      .from("legacy_members")
      .select("personal_email, campus_email")
      .eq("campus_email", eduEmail)
      .single();
    const es = eduStaged as Record<string, unknown> | null;
    check("allowlisted .edu staged as campus_email", es?.campus_email === eduEmail);
    check("personal_email left free for the Google address", es?.personal_email === null);

    // Sign up with a DIFFERENT (personal) address — the case that email
    // matching cannot solve and the claim token exists for.
    const { data: gu, error: guErr } = await admin.auth.admin.createUser({
      email: googleEmail,
      password,
      email_confirm: true,
    });
    if (guErr || !gu.user) throw new Error(`create google user: ${guErr?.message}`);
    googleId = gu.user.id;

    const { data: beforeClaim } = await admin
      .from("profiles")
      .select("student_email")
      .eq("id", googleId)
      .single();
    check(
      "email matching alone does NOT link a .edu registration",
      (beforeClaim as { student_email: string | null })?.student_email === null,
      beforeClaim
    );

    const asUser = createClient(url, anonKey, noSession);
    const { error: signInErr } = await asUser.auth.signInWithPassword({
      email: googleEmail,
      password,
    });
    if (signInErr) throw new Error(`sign in: ${signInErr.message}`);

    const { data: claimed, error: claimErr } = await asUser.rpc(
      "claim_guest_identity",
      { p_token: eduToken }
    );
    check("claim_guest_identity succeeds for the signed-in user", !claimErr, claimErr?.message);
    check("claim reports it linked something", claimed === true, claimed);

    const { data: afterClaim } = await admin
      .from("profiles")
      .select("first_name, last_name, phone_number, student_email, student_email_verified, school")
      .eq("id", googleId)
      .single();
    const ac = afterClaim as Record<string, unknown> | null;
    check("claim carried the school email onto the profile", ac?.student_email === eduEmail);
    check("school email is NOT marked verified", ac?.student_email_verified === false);
    check("school derived from the domain", ac?.school === "Georgia State University");
    check("claim carried the phone", ac?.phone_number === "678 555 0177");
    check("claim carried the name", ac?.first_name === "Edu" && ac?.last_name === "Guest");

    const { data: reclaim } = await asUser.rpc("claim_guest_identity", {
      p_token: eduToken,
    });
    check("re-claiming the same token is a harmless no-op", reclaim === true, reclaim);

    const { data: unknownClaim } = await asUser.rpc("claim_guest_identity", {
      p_token: "00000000-0000-0000-0000-000000000000",
    });
    check("an unknown token claims nothing", unknownClaim === false, unknownClaim);
    await asUser.auth.signOut();

    // --- 7. claim on first login -----------------------------------------
    // Stage a second identity, then sign that person up: handle_new_user
    // should carry the answers onto the fresh profile.
    await admin.from("legacy_members").insert({
      full_name: "Grace Claimer",
      first_name: "Grace",
      last_name: "Claimer",
      personal_email: claimEmail,
      phone_number: "770 555 0133",
      phone_e164: "+17705550133",
      source: "guest_rsvp",
      source_detail: slug,
      major: majorSlug,
      grad_year: 2027,
      class_standing: "senior",
      interested_roles: ["data_science"],
      answered_at: new Date().toISOString(),
    });

    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({
      email: claimEmail,
      password,
      email_confirm: true,
    });
    if (cuErr || !cu.user) throw new Error(`create claimer: ${cuErr?.message}`);
    claimedId = cu.user.id;

    const { data: claimedProfile } = await admin
      .from("profiles")
      .select("phone_number, major, grad_year, class_standing, interested_roles")
      .eq("id", claimedId)
      .single();
    const cp = claimedProfile as Record<string, unknown> | null;
    check("claim copied phone_number", cp?.phone_number === "770 555 0133");
    check("claim copied major", cp?.major === majorSlug);
    check("claim copied grad_year", cp?.grad_year === 2027);
    check("claim copied class_standing", cp?.class_standing === "senior");
    check(
      "claim copied interested_roles over the empty-array default",
      Array.isArray(cp?.interested_roles) &&
        (cp?.interested_roles as string[])[0] === "data_science",
      cp?.interested_roles
    );

    const { data: claimedRow } = await admin
      .from("legacy_members")
      .select("claimed_at, claimed_profile_id")
      .eq("personal_email", claimEmail)
      .single();
    const cr = claimedRow as Record<string, unknown> | null;
    check("staging row stamped claimed_at", !!cr?.claimed_at);
    check("staging row points at the new profile", cr?.claimed_profile_id === claimedId);

    // Consents are deliberately NOT promoted from staging — §6.2.
    const { count: consentCount } = await admin
      .from("consents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", claimedId);
    check(
      "claim writes no consent rows (SMS consent is not promoted from staging)",
      consentCount === 0,
      consentCount
    );

    // --- 8. suppression list ---------------------------------------------
    // Regression guard for 20260823150600: `revoke ... from public` does not
    // close Supabase's default EXECUTE grants to anon/authenticated.
    const { error: anonSuppressErr } = await anon.rpc("suppress_sms_number", {
      p_phone: guestPhone,
      p_reason: "stop_keyword",
    });
    check("anon cannot write the suppression list", !!anonSuppressErr, anonSuppressErr);

    const { error: anonUpsertErr } = await anon.rpc("upsert_guest_identity", {
      p_name: "Injected Person",
      p_email: `injected-${suffix}@example.com`,
      p_phone: "404 555 0000",
      p_source_detail: slug,
    });
    check(
      "anon cannot stage a guest identity directly",
      !!anonUpsertErr,
      anonUpsertErr
    );

    await admin.rpc("suppress_sms_number", {
      p_phone: guestPhone,
      p_reason: "stop_keyword",
    });
    const { error: repeatErr } = await admin.rpc("suppress_sms_number", {
      p_phone: "(201) 555-0188",
      p_reason: "manual",
    });
    check("a repeat STOP is idempotent, not an error", !repeatErr, repeatErr?.message);

    const { data: sup } = await admin
      .from("sms_suppressions")
      .select("phone_e164, reason")
      .eq("phone_e164", "+12015550188")
      .single();
    check(
      "the first opt-out reason is preserved",
      (sup as { reason: string } | null)?.reason === "stop_keyword",
      sup
    );

    const { data: anonSup } = await anon.from("sms_suppressions").select("phone_e164");
    check("anon cannot read the suppression list", (anonSup ?? []).length === 0);
  } finally {
    if (eventId) await admin.from("events").delete().eq("id", eventId);
    await admin.from("legacy_members").delete().eq("personal_email", guestEmail);
    await admin.from("legacy_members").delete().eq("personal_email", claimEmail);
    await admin
      .from("legacy_members")
      .delete()
      .eq("personal_email", `injected-${suffix}@example.com`);
    await admin.from("sms_suppressions").delete().eq("phone_e164", "+12015550188");
    await admin
      .from("legacy_members")
      .delete()
      .eq("campus_email", `smoke-conv-edu-${suffix}@student.gsu.edu`);
    if (googleId) await admin.auth.admin.deleteUser(googleId);
    if (claimedId) await admin.auth.admin.deleteUser(claimedId);
    if (memberId) await admin.auth.admin.deleteUser(memberId);
    if (adminId) await admin.auth.admin.deleteUser(adminId);
  }

  if (failures > 0) {
    console.error(`\nsmoke-guest-conversion: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nsmoke-guest-conversion: all checks passed");
}

main().catch((err) => {
  console.error("smoke-guest-conversion threw:", err);
  process.exit(1);
});
