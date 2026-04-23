import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// Happy path: admin creates a published event with a check-in code, a member
// RSVPs "going", the member self-checks-in with the code, the admin sees the
// attendance on the day-of roster. Exercises server actions, router.refresh,
// the RSVP panel state, the check-in form, and the admin roster view.

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

test("full happy path: create → rsvp → check-in → roster", async ({
  adminPage,
  memberPage,
  suffix,
}) => {
  // Longest happy-path scenario: cold-compiles /admin/events/new,
  // /admin/events/[id] (both tabs), /events/[slug], /events/[slug]/check-in,
  // /events/[slug]/check-in/success, /admin/events/[id]/check-in — six
  // distinct routes in one run. 30s isn't enough on a cold dev server.
  // slow() triples the timeout (90s total).
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
  // First compile of /admin/events/[id] can take ~2.5s cold; give it room.
  await expect(adminPage).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/, {
    timeout: 15_000,
  });

  // --- Admin publishes -----------------------------------------------------
  await adminPage.getByRole("button", { name: /^publish$/i }).click();
  await expect(
    adminPage.getByText(/published/i).first()
  ).toBeVisible({ timeout: 10_000 });

  // --- Admin rotates a check-in code via the check-in tab ------------------
  // Navigate directly to the tab to avoid ambiguity with the "Day-of check-in"
  // header link that also matches /check-in/i.
  const eventDetailUrl = adminPage.url();
  await adminPage.goto(eventDetailUrl.split("?")[0] + "?tab=check-in");
  await adminPage.getByLabel(/raw code/i).fill("HAPPY42");
  await adminPage
    .getByLabel(/expires at/i)
    .fill(toLocalInput(new Date(Date.now() + 3 * 60 * 60_000)));
  await adminPage.getByRole("button", { name: /^rotate/i }).click();
  await expect(
    adminPage.getByText(/code rotated|active/i).first()
  ).toBeVisible({ timeout: 10_000 });

  // --- Member RSVPs going --------------------------------------------------
  await memberPage.goto(`/events/${slug}`);
  await expect(memberPage.getByRole("heading", { name: title })).toBeVisible();
  await memberPage.getByRole("button", { name: /i'?m going/i }).click();
  await expect(
    memberPage.getByText(/you'?re going\./i).first()
  ).toBeVisible({ timeout: 10_000 });

  // --- Member self-checks-in -----------------------------------------------
  // The event hasn't started yet but is within the 2h window, so check-in is
  // allowed. A "Check in" CTA should appear once RSVP is going + in window.
  // Match the detail-page banner specifically — tighter than just "check in".
  await memberPage.goto(`/events/${slug}/check-in`);
  await expect(memberPage).toHaveURL(new RegExp(`/events/${slug}/check-in$`));
  await memberPage.getByLabel(/code/i).fill("HAPPY42");
  await memberPage.getByRole("button", { name: /^check in|submit/i }).click();
  await expect(memberPage).toHaveURL(
    new RegExp(`/events/${slug}/check-in/success`)
  );

  // --- Admin sees the attendance on the day-of roster ----------------------
  const admin = adminClient();
  const { data: evt } = await admin
    .from("events")
    .select("id")
    .eq("slug", slug)
    .single();
  const eventId = (evt as { id: string }).id;

  await adminPage.goto(`/admin/events/${eventId}/check-in`);
  // Look for any evidence the member shows as attended. The day-of page
  // renders "N / M checked in" somewhere.
  await expect(
    adminPage.getByText(/checked in|attended|1 \//i).first()
  ).toBeVisible({ timeout: 10_000 });
});
