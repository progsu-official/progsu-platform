import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// Full account-free guest loop (2026-08-21 guest-ticket decision), Luma-style:
// signed-out register → confirmation email fires with an event link and a
// ticket link → the hosted ticket page renders a QR bound to that
// registration → staff check the guest in through the SAME token path the QR
// scanner uses → the ticket flips to its checked-in state.
//
// On the email assertion: this app sends through Resend, not SMTP, so
// Supabase's local Mailpit never sees an application email (it only catches
// Supabase *auth* mail). Two substitutes, and between them they cover more
// than a Mailpit body grep would:
//   1. Here: audit_log proves the send path actually fired for the right
//      recipient carrying both URLs, and navigating the ticket_url from that
//      row proves the link a real recipient would click resolves to a working
//      ticket. sendGuestRsvpConfirmation writes the audit row regardless of
//      transport outcome, so a delivery failure against an @example.com
//      address can't hide broken wiring.
//   2. scripts/smoke-guest-ticket.ts asserts the rendered HTML itself carries
//      both links as real anchors. It lives there rather than here because
//      Playwright's JSX transform rewrites .tsx imports into its own component
//      -testing shape, which react-dom refuses to render.

type ConfirmationAudit = {
  metadata: {
    email: string;
    event_url: string;
    ticket_url: string;
    ok: boolean;
    error_code: string | null;
  };
};

test("guest loop: register → confirmation email → ticket QR → staff check-in", async ({
  browser,
  adminPage,
  adminUserId,
  suffix,
}) => {
  // Four cold routes in one run (/events/[slug], /tickets/[token],
  // /admin/events/[id]) plus a fire-and-forget outbound email.
  test.slow();

  const admin = adminClient();
  const slug = `guest-${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
  const title = "Guest Ticket E2E";
  const guestName = "Ada Guest";
  const guestEmail = `guest-${suffix}@example.com`;
  const locationText = "Rialto Center, Atlanta";

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
      created_by: adminUserId,
      updated_by: adminUserId,
      published_at: new Date().toISOString(),
      send_rsvp_email: true,
    })
    .select("id")
    .single();
  if (evErr || !ev) throw new Error(`seed event: ${evErr?.message}`);
  const eventId = (ev as { id: string }).id;

  // Signed-out visitor: a fresh context with no injected auth cookies at all.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();

  try {
    // --- Guest registers through the modal --------------------------------
    await guestPage.goto(`/events/${slug}`);
    await expect(guestPage.getByRole("heading", { name: title })).toBeVisible();
    await guestPage.getByRole("button", { name: /^register$/i }).click();

    const modal = guestPage.getByRole("dialog", { name: /rsvp as a guest/i });
    await expect(modal).toBeVisible();
    await modal.getByLabel(/name/i).fill(guestName);
    await modal.getByLabel(/email/i).fill(guestEmail);
    await modal.getByLabel(/phone/i).fill("201 555 0123");
    await modal.getByRole("button", { name: /^register$/i }).click();

    // Since docs/16-guest-conversion the modal no longer shows a success card
    // — a successful RSVP redirects to the token-keyed /welcome page.
    await guestPage.waitForURL(/\/joined\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(
      guestPage.getByRole("button", { name: /create your account with google/i })
    ).toBeVisible({ timeout: 15_000 });

    // The DB minted a token because the effective status is 'going'.
    const { data: guestRow, error: guestErr } = await admin
      .from("event_guest_rsvps")
      .select("id, status, checkin_token")
      .eq("event_id", eventId)
      .eq("email", guestEmail)
      .single();
    if (guestErr || !guestRow) {
      throw new Error(`event_guest_rsvps read: ${guestErr?.message}`);
    }
    const { status, checkin_token: token } = guestRow as {
      status: string;
      checkin_token: string | null;
    };
    expect(status).toBe("going");
    expect(token).toBeTruthy();

    // --- The confirmation email fired, with both links --------------------
    // Fire-and-forget, so poll rather than assume it has landed by now.
    async function confirmationAudit(): Promise<ConfirmationAudit | null> {
      const { data } = await admin
        .from("audit_log")
        .select("metadata")
        .eq("action", "event.guest_confirmation_email")
        .order("created_at", { ascending: false })
        .limit(20);
      const rows = (data ?? []) as ConfirmationAudit[];
      return rows.find((r) => r.metadata?.email === guestEmail) ?? null;
    }

    await expect
      .poll(async () => (await confirmationAudit()) !== null, {
        timeout: 30_000,
        message: "guest confirmation email should have been attempted",
      })
      .toBe(true);

    const auditRow = (await confirmationAudit())!;
    expect(auditRow.metadata.event_url).toContain(`/events/${slug}`);
    expect(auditRow.metadata.ticket_url).toContain(`/tickets/${token}`);

    // --- Ticket page, reached by the link a recipient would click ---------
    // Still the signed-out context: this must work with no session.
    const ticketPath = new URL(auditRow.metadata.ticket_url).pathname;
    await guestPage.goto(ticketPath);
    const ticket = guestPage.getByRole("region", { name: /your ticket/i });
    await expect(ticket).toBeVisible({ timeout: 15_000 });
    await expect(ticket.getByText(guestName)).toBeVisible();
    await expect(ticket.getByText(guestEmail)).toBeVisible();
    await expect(ticket.getByAltText(/your check-in qr code/i)).toBeVisible();
    await expect(guestPage.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      ticket.getByRole("link", { name: /get directions/i })
    ).toBeVisible();

    // --- Staff check the guest in from the admin Guests tab ---------------
    // GuestsTab renders under ?tab=attendees, not ?tab=guests — an unknown
    // tab value silently falls back to Details, which is what made an earlier
    // pass of this test look like a missing fold rather than a wrong URL.
    await adminPage.goto(`/admin/events/${eventId}?tab=attendees`);
    // FoldSection is a native <details>; its body is display:none until the
    // summary is clicked, so the button isn't actionable before this.
    await adminPage
      .getByRole("heading", { name: /guest rsvps \(1\)/i })
      .click();
    // Scope to the Guest RSVPs disclosure: the member roster on the same tab
    // renders its own "Check in" buttons, so an unscoped match is ambiguous.
    const guestFold = adminPage
      .locator("details")
      .filter({ has: adminPage.getByRole("heading", { name: /guest rsvps/i }) });
    await expect(guestFold.getByText(guestEmail)).toBeVisible();
    await guestFold.getByRole("button", { name: /^check in$/i }).click();

    await expect
      .poll(
        async () => {
          const { count } = await admin
            .from("event_guest_attendances")
            .select("*", { count: "exact", head: true })
            .eq("event_id", eventId);
          return count ?? -1;
        },
        {
          timeout: 30_000,
          message: "guest attendance row should exist after check-in",
        }
      )
      .toBe(1);

    // Member attendance table is untouched — guest check-in must not have
    // leaked into the member roster path.
    const { count: memberAttendance } = await admin
      .from("event_attendances")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);
    expect(memberAttendance).toBe(0);

    // --- Ticket flips to its checked-in state ----------------------------
    await guestPage.reload();
    const stamped = guestPage.getByRole("region", { name: /your ticket/i });
    await expect(stamped).toBeVisible({ timeout: 15_000 });
    await expect(stamped.getByText(/^checked in$/i)).toBeVisible();
    await expect(stamped.getByText(/see you in there/i)).toBeVisible();
    // The live QR is retired once redeemed.
    await expect(
      stamped.getByAltText(/your check-in qr code/i)
    ).toHaveCount(0);

    // --- Unknown token gets a clean state, not a crash -------------------
    await guestPage.goto("/tickets/00000000-0000-0000-0000-000000000000");
    await expect(
      guestPage.getByRole("heading", { name: /isn'?t valid/i })
    ).toBeVisible();
    // A non-uuid segment is rejected before the DB round-trip.
    await guestPage.goto("/tickets/not-a-uuid");
    await expect(
      guestPage.getByRole("heading", { name: /isn'?t valid/i })
    ).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
