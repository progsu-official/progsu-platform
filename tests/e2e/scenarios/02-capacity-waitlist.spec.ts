import { test, expect } from "../fixtures";
import {
  E2E_PASSWORD,
  deleteUser,
  makeFullyOnboardedUser,
} from "../helpers/seed";
import { adminClient, signInAndInjectCookies } from "../helpers/session";

// Capacity=2 with waitlist enabled. Three members RSVP: first two land
// "going", third lands "waitlisted". Admin promotes waitlisted member via
// the guests tab; member reloads and sees "going".

test("capacity=2: third RSVP waitlisted, admin promotes", async ({
  browser,
  adminUserId,
  memberPage,
  memberAlicePage,
  suffix,
}) => {
  const admin = adminClient();
  const slug = `wait-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);

  // Seed a third member (Carol) inline — no fixture for "third member" by design.
  const carolEmail = `carol-${suffix}@example.com`;
  const carol = await makeFullyOnboardedUser(carolEmail, { firstName: "Carol" });
  const carolContext = await browser.newContext();
  await signInAndInjectCookies(carolContext, carolEmail, E2E_PASSWORD);
  const carolPage = await carolContext.newPage();

  try {
    // Seed a cap=2 waitlist-enabled event. Starts 30 min from now so rsvpOpen
    // stays true.
    const starts = new Date(Date.now() + 30 * 60_000);
    const ends = new Date(Date.now() + 120 * 60_000);
    const { data: ev } = await admin
      .from("events")
      .insert({
        slug,
        title: "Waitlist Test",
        status: "published",
        visibility: "members",
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        capacity: 2,
        waitlist_enabled: true,
        created_by: adminUserId,
        updated_by: adminUserId,
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const eventId = (ev as { id: string }).id;

    // Member and Alice RSVP — both "going" (cap=2, nobody ahead).
    for (const p of [memberPage, memberAlicePage]) {
      await p.goto(`/events/${slug}`);
      await p.getByRole("button", { name: /i'?m going/i }).click();
      await expect(
        p.getByText(/you'?re going\./i).first()
      ).toBeVisible({ timeout: 10_000 });
    }

    // Carol RSVPs — the button label is "I'm going" OR "Join waitlist"
    // depending on whether her page-render saw capacity-reached or not.
    // Either way, the RPC will route her to "waitlisted" because cap=2.
    await carolPage.goto(`/events/${slug}`);
    const carolRsvpButton = carolPage
      .getByRole("button", { name: /i'?m going|join waitlist/i })
      .first();
    await carolRsvpButton.click();
    await expect(carolPage.getByText(/on the waitlist/i)).toBeVisible({
      timeout: 10_000,
    });

    // Realistic scenario: someone cancels, which opens a slot for the
    // waitlisted user. promote_waitlisted_member respects capacity; to test
    // promotion we must first free a slot. Have Member cancel their RSVP.
    await memberPage.getByRole("button", { name: /i can'?t make it|cancel/i }).first().click();
    await expect(
      memberPage.getByText(/can'?t make it|cancelled|not going/i).first()
    ).toBeVisible({ timeout: 10_000 });

    // Admin promotes Carol via the guests tab.
    const adminContext = await browser.newContext();
    await signInAndInjectCookies(
      adminContext,
      `admin-${suffix}@example.com`,
      E2E_PASSWORD
    );
    const adminPage = await adminContext.newPage();
    try {
      await adminPage.goto(`/admin/events/${eventId}?tab=guests`);
      const bodyText = await adminPage.locator("body").innerText();
      console.log("[debug] admin guests body (first 500):", bodyText.slice(0, 500));
      // Find the Promote button directly — there's exactly one since only
      // Carol is waitlisted. Avoids fragility around row-filter text matching
      // (first/last names might render differently than we expect).
      const promoteBtn = adminPage.getByRole("button", { name: /^promote$/i });
      await expect(promoteBtn).toBeEnabled();
      await promoteBtn.click();

      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("event_rsvps")
              .select("status")
              .eq("event_id", eventId)
              .eq("status", "waitlisted");
            return data?.length ?? -1;
          },
          { timeout: 10_000, message: "waitlisted should drop to 0 after promote" }
        )
        .toBe(0);
    } finally {
      await adminContext.close();
    }

    // Carol reloads and sees she's now going.
    await carolPage.reload();
    await expect(
      carolPage.getByText(/you'?re going\./i).first()
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await carolContext.close();
    await deleteUser(carol.id);
  }
});
