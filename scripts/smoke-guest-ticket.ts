#!/usr/bin/env tsx
// Smoke: the account-free guest ticket loop (2026-08-21 guest-ticket
// decision). Covers the layers the Playwright scenario can't reach:
//
//   1. guest_rsvp_to_event mints a checkin_token on the 'going' path.
//   2. guest_ticket_by_token is readable by anon and by anon only for a token
//      it actually holds; an unknown token is an empty set, not an error.
//   3. anon cannot call admin_check_in_by_token at all.
//   4. admin_check_in_by_token resolves a GUEST token: writes
//      event_guest_attendances, returns out_user_id = NULL, and leaves
//      event_attendances alone. Second call is rejected as already checked in.
//      (This is the regression guard for the `return query` fall-through fixed
//      in 20260821070000 — without the bare `return;` the guest branch
//      continued into the member insert and died on user_id NOT NULL.)
//   5. admin_check_in_by_token still resolves a MEMBER token to a real
//      out_user_id and writes event_attendances.
//   6. admin_event_guest_rsvps_for surfaces checkin_token + checked_in_at.
//   7. GuestRsvpConfirmationEmail renders both the event link and the ticket
//      link as real anchors. Lives here rather than in the Playwright spec
//      because Playwright's JSX transform rewrites .tsx imports into its own
//      component-testing shape, which react-dom refuses to render.

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
  const { render } = await import("@react-email/render");
  const GuestRsvpConfirmationEmail = (
    await import("../emails/GuestRsvpConfirmationEmail")
  ).default;
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

  const admin = createClient(url, SUPABASE_SERVICE_ROLE_KEY, noSession);
  const anon = createClient(url, anonKey, noSession);

  const suffix = Date.now().toString(36);
  const adminEmail = `smoke-guest-admin-${suffix}@example.com`;
  const guestEmail = `smoke-guest-${suffix}@example.com`;
  const password = "testpassword-12345";
  const slug = `smoke-guest-ticket-${suffix}`;
  const title = "Guest Ticket Smoke";
  const locationText = "Rialto Center, Atlanta";

  let adminId: string | null = null;
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

    const starts = new Date(Date.now() + 30 * 60_000);
    const ends = new Date(Date.now() + 120 * 60_000);
    const { data: ev, error: evErr } = await admin
      .from("events")
      .insert({
        slug,
        title,
        status: "published",
        visibility: "members",
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        location_text: locationText,
        location_url: "https://maps.google.com/?q=rialto+center",
        created_by: adminId,
        updated_by: adminId,
        published_at: new Date().toISOString(),
        send_rsvp_email: true,
      })
      .select("id")
      .single();
    if (evErr || !ev) throw new Error(`insert event: ${evErr?.message}`);
    eventId = (ev as { id: string }).id;

    // --- 1. anon guest RSVP mints a token ---------------------------------
    const { data: effective, error: rsvpErr } = await anon.rpc(
      "guest_rsvp_to_event",
      {
        p_event_id: eventId,
        p_name: "Ada Guest",
        p_email: guestEmail,
        p_phone: "201 555 0123",
      }
    );
    if (rsvpErr) throw new Error(`guest_rsvp_to_event: ${rsvpErr.message}`);
    check("anon guest RSVP lands 'going'", effective === "going", effective);

    const { data: gRow } = await admin
      .from("event_guest_rsvps")
      .select("id, checkin_token")
      .eq("event_id", eventId)
      .eq("email", guestEmail)
      .single();
    const guestToken = (gRow as { checkin_token: string | null })?.checkin_token;
    check("checkin_token minted on 'going'", !!guestToken);
    if (!guestToken) throw new Error("no guest token; cannot continue");

    // --- 2. anon ticket read ----------------------------------------------
    const { data: t1, error: t1Err } = await anon
      .rpc("guest_ticket_by_token", { p_token: guestToken })
      .maybeSingle();
    check("guest_ticket_by_token readable by anon", !t1Err, t1Err?.message);
    const ticket = t1 as Record<string, unknown> | null;
    check("ticket carries the holder's name", ticket?.guest_name === "Ada Guest");
    check("ticket carries the event title", ticket?.event_title === title);
    check("ticket carries the event slug", ticket?.event_slug === slug);
    check("ticket not yet checked in", ticket?.checked_in === false);
    check("ticket checked_in_at null", ticket?.checked_in_at === null);

    const { data: tUnknown, error: tUnknownErr } = await anon
      .rpc("guest_ticket_by_token", {
        p_token: "00000000-0000-0000-0000-000000000000",
      })
      .maybeSingle();
    check(
      "unknown token is an empty set, not an error",
      tUnknown === null && !tUnknownErr,
      tUnknownErr?.message
    );

    // --- 3. anon cannot check anyone in -----------------------------------
    const { error: anonCheckErr } = await anon.rpc("admin_check_in_by_token", {
      p_token: guestToken,
      p_note: null,
    });
    check(
      "anon denied on admin_check_in_by_token",
      !!anonCheckErr && /admin only/i.test(anonCheckErr.message),
      anonCheckErr?.message
    );

    // --- 4. admin check-in resolves the GUEST token -----------------------
    const adminCtx = createClient(url, anonKey, noSession);
    const { error: signInErr } = await adminCtx.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    if (signInErr) throw new Error(`admin signIn: ${signInErr.message}`);

    const { data: ci, error: ciErr } = await adminCtx.rpc(
      "admin_check_in_by_token",
      { p_token: guestToken, p_note: null }
    );
    check("guest check-in by token succeeds", !ciErr, ciErr?.message);
    const ciRow = (Array.isArray(ci) ? ci[0] : ci) as
      | { out_event_id: string; out_user_id: string | null }
      | undefined;
    check("guest check-in returns the event id", ciRow?.out_event_id === eventId);
    check("guest check-in returns NULL out_user_id", ciRow?.out_user_id === null);

    const { count: guestAttendance } = await admin
      .from("event_guest_attendances")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);
    check("one event_guest_attendances row", guestAttendance === 1, guestAttendance);

    const { count: memberAttendanceAfterGuest } = await admin
      .from("event_attendances")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);
    check(
      "guest check-in did not touch event_attendances",
      memberAttendanceAfterGuest === 0,
      memberAttendanceAfterGuest
    );

    const { error: dupErr } = await adminCtx.rpc("admin_check_in_by_token", {
      p_token: guestToken,
      p_note: null,
    });
    check(
      "second guest check-in rejected",
      !!dupErr && /already checked in/i.test(dupErr.message),
      dupErr?.message
    );

    const { data: t2 } = await anon
      .rpc("guest_ticket_by_token", { p_token: guestToken })
      .maybeSingle();
    const ticket2 = t2 as Record<string, unknown> | null;
    check("ticket now reads checked_in", ticket2?.checked_in === true);
    check("ticket carries checked_in_at", !!ticket2?.checked_in_at);

    // --- 5. the MEMBER branch still works --------------------------------
    await admin
      .from("event_rsvps")
      .insert({ event_id: eventId, user_id: adminId, status: "going" });
    const { data: mRow } = await admin
      .from("event_rsvps")
      .select("checkin_token")
      .eq("event_id", eventId)
      .eq("user_id", adminId)
      .single();
    const memberToken = (mRow as { checkin_token: string | null })?.checkin_token;
    check("member checkin_token minted by trigger", !!memberToken);

    const { data: mci, error: mciErr } = await adminCtx.rpc(
      "admin_check_in_by_token",
      { p_token: memberToken, p_note: null }
    );
    check("member check-in by token succeeds", !mciErr, mciErr?.message);
    const mciRow = (Array.isArray(mci) ? mci[0] : mci) as
      | { out_event_id: string; out_user_id: string | null }
      | undefined;
    check(
      "member check-in returns a real out_user_id",
      mciRow?.out_user_id === adminId,
      mciRow
    );
    const { count: memberAttendance } = await admin
      .from("event_attendances")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);
    check("one event_attendances row", memberAttendance === 1, memberAttendance);

    // --- 6. admin guest list surfaces token + checked_in_at ---------------
    const { data: list, error: listErr } = await adminCtx.rpc(
      "admin_event_guest_rsvps_for",
      { p_event_id: eventId }
    );
    check("admin_event_guest_rsvps_for succeeds", !listErr, listErr?.message);
    const listRow = ((list ?? []) as Array<Record<string, unknown>>)[0];
    check("admin list exposes checkin_token", listRow?.checkin_token === guestToken);
    check("admin list exposes checked_in_at", !!listRow?.checked_in_at);

    // --- 7. the confirmation email renders both links ---------------------
    const eventUrl = `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/events/${slug}`;
    const ticketUrl = `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/tickets/${guestToken}`;
    const html = await render(
      GuestRsvpConfirmationEmail({
        guestName: "Ada Guest",
        eventTitle: title,
        startsAt: starts,
        endsAt: ends,
        location: locationText,
        eventUrl,
        ticketUrl,
        siteUrl: env.NEXT_PUBLIC_SITE_URL,
      })
    );
    check("email says 'You have registered for'", html.includes("You have registered for"));
    check("email carries the event title", html.includes(title));
    check("email carries the location", html.includes(locationText));
    check("email links the event page", html.includes(`href="${eventUrl}"`));
    check("email links the ticket page", html.includes(`href="${ticketUrl}"`));
    check("email labels the ticket button", html.includes("My ticket"));
    check("email embeds no QR image", !html.includes("cid:"));
  } finally {
    if (eventId) await admin.from("events").delete().eq("id", eventId);
    if (adminId) await admin.auth.admin.deleteUser(adminId);
  }

  if (failures > 0) {
    console.error(`\nsmoke-guest-ticket: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nsmoke-guest-ticket: all checks passed");
}

main().catch((err) => {
  console.error("smoke-guest-ticket threw:", err);
  process.exit(1);
});
