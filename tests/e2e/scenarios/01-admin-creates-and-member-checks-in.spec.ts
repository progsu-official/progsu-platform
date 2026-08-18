import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// Happy path, QR-ticket era (D12/D13): admin creates + publishes an event, a
// member RSVPs "going" and receives a personal ticket whose QR encodes their
// unique checkin_token, staff check them in from the admin roster (the manual
// fallback for the camera scan — headless Chromium has no camera), and the
// member's ticket flips to its checked-in state. Exercises server actions,
// router.refresh, the RSVP panel, the ticket render, and the day-of roster.

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

test("full happy path: create → rsvp → ticket → check-in → roster", async ({
  adminPage,
  memberPage,
  memberUserId,
  suffix,
}) => {
  // Longest happy-path scenario: cold-compiles /admin/events/new,
  // /admin/events/[id], /events/[slug], /admin/events/[id]/check-in — four
  // distinct routes in one run. slow() triples the per-test budget (60s → 180s).
  test.slow();
  const slug = `happy-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  const title = "Happy Path E2E";

  // --- Admin creates a draft event -----------------------------------------
  await adminPage.goto("/admin/events/new");
  await adminPage.getByLabel(/title/i).fill(title);
  await adminPage.getByLabel(/slug/i).fill(slug);

  // Starts in 30 min, ends in 2 hours — well inside the 2h pre-start
  // check-in window AND leaves plenty of headroom so the RSVP panel doesn't
  // close mid-test (rsvpOpen requires startMs > nowMs).
  const starts = new Date(Date.now() + 30 * 60_000);
  const ends = new Date(Date.now() + 120 * 60_000);
  await adminPage.getByLabel(/starts/i).fill(toLocalInput(starts));
  await adminPage.getByLabel(/ends/i).fill(toLocalInput(ends));

  await adminPage.getByRole("button", { name: /create draft event/i }).click();
  // First compile of /admin/events/[id] has been observed at 17s+ cold; match
  // the global navigationTimeout budget.
  await expect(adminPage).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/, {
    timeout: 45_000,
  });

  // --- Admin publishes -----------------------------------------------------
  await adminPage.getByRole("button", { name: /^publish$/i }).click();
  await expect(
    adminPage.getByText(/published/i).first()
  ).toBeVisible({ timeout: 10_000 });

  // --- Member RSVPs going --------------------------------------------------
  await memberPage.goto(`/events/${slug}`);
  await expect(memberPage.getByRole("heading", { name: title })).toBeVisible();
  await memberPage.getByRole("button", { name: /i'?m going/i }).click();
  await expect(
    memberPage.getByText(/you'?re going\./i).first()
  ).toBeVisible({ timeout: 10_000 });

  // --- Member holds a personal ticket --------------------------------------
  // The RSVP trigger minted a unique checkin_token; the page renders it as a
  // QR on the ticket, plus the holder's name and a ticket number derived from
  // the token — assert the rendered number matches the DB so we know THIS
  // member's ticket is bound to THIS member's token.
  const admin = adminClient();
  const { data: evt } = await admin
    .from("events")
    .select("id")
    .eq("slug", slug)
    .single();
  const eventId = (evt as { id: string }).id;

  const { data: rsvpRow, error: rsvpErr } = await admin
    .from("event_rsvps")
    .select("checkin_token")
    .eq("event_id", eventId)
    .eq("user_id", memberUserId)
    .single();
  if (rsvpErr || !rsvpRow) {
    throw new Error(
      `event_rsvps read failed for event=${eventId} user=${memberUserId}: ${rsvpErr?.message ?? "no row"}`
    );
  }
  const token = (rsvpRow as { checkin_token: string | null }).checkin_token;
  expect(token).toBeTruthy();

  await memberPage.reload();
  const ticket = memberPage.getByRole("region", { name: /your ticket/i });
  await expect(ticket).toBeVisible({ timeout: 10_000 });
  await expect(ticket.getByText(/general admission/i)).toBeVisible();
  await expect(ticket.getByText("Member E2E")).toBeVisible();
  await expect(
    ticket.getByText((token as string).slice(0, 8).toUpperCase())
  ).toBeVisible();
  await expect(
    ticket.getByAltText(/your check-in qr code/i)
  ).toBeVisible();

  // --- Staff check the member in from the day-of roster --------------------
  // Camera scan (adminCheckInByToken) needs getUserMedia; headless Chromium
  // has no camera, so exercise the documented manual fallback instead.
  await adminPage.goto(`/admin/events/${eventId}/check-in`);
  await adminPage.getByRole("button", { name: /^check in$/i }).click();
  // The action + router.refresh round-trip has been observed > 10s when the
  // dev server is under full-suite load.
  await expect(
    adminPage.getByRole("button", { name: /undo/i })
  ).toBeVisible({ timeout: 30_000 });

  // --- Member's ticket flips to its checked-in state -----------------------
  await memberPage.reload();
  const stampedTicket = memberPage.getByRole("region", { name: /your ticket/i });
  await expect(stampedTicket).toBeVisible({ timeout: 10_000 });
  await expect(
    stampedTicket.getByText(/checked in/i).first()
  ).toBeVisible();
});
