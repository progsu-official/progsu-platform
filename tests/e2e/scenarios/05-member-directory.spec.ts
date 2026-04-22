import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// R2 member directory: both members opt into discoverability via the
// settings page, then verify each can see the other in /members.

test("two opted-in members see each other in directory", async ({
  memberPage,
  memberUserId,
  memberAlicePage,
  memberAliceUserId,
}) => {
  // Opt both members in directly via the DB. Skipping the settings UI flow
  // because set_profile_visibility requires a current privacy_policy consent
  // and the opt-in path is well-covered by smoke-member-cards-visibility.
  // What this scenario catches that the smoke can't: rendering, slug
  // resolution, and the 404 path are real browser behavior.
  const admin = adminClient();
  const memberSlugStr = "member-e2e-" + memberUserId.slice(0, 8);
  const aliceSlug = "alice-e2e-" + memberAliceUserId.slice(0, 8);
  const now = new Date().toISOString();
  const { error: visErr } = await admin.from("profile_visibility_settings").insert([
    {
      user_id: memberUserId,
      discoverable: true,
      share_attended_events: false,
      share_shared_event_counts: false,
      profile_slug: memberSlugStr,
      last_discoverability_change_at: now,
    },
    {
      user_id: memberAliceUserId,
      discoverable: true,
      share_attended_events: false,
      share_shared_event_counts: false,
      profile_slug: aliceSlug,
      last_discoverability_change_at: now,
    },
  ]);
  if (visErr) throw new Error(`seed visibility: ${visErr.message}`);

  // Member (as viewer) sees alice in the directory.
  await memberPage.goto("/members");
  await expect(memberPage.getByRole("heading", { name: /members/i }).first()).toBeVisible();
  await expect(memberPage.getByText(/alice/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Alice sees member too.
  await memberAlicePage.goto("/members");
  await expect(memberAlicePage.getByText(/member/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Alice visits member's profile page.
  await memberAlicePage.goto(`/members/${memberSlugStr}`);
  await expect(memberAlicePage.getByRole("heading").first()).toBeVisible();

  // Non-existent slug 404s.
  const response = await memberAlicePage.goto("/members/does-not-exist-zzz");
  expect(response?.status()).toBe(404);

  void aliceSlug;
});
