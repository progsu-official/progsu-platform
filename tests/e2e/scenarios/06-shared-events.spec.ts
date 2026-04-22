import { randomUUID } from "node:crypto";

import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// R3 shared events: when two members have both opted into
// share_shared_event_counts AND both attended the same event AND the event
// clears the attendee threshold, each sees a "Shared events with you" section
// on the other's profile.
//
// THRESHOLD NOTE: the migration ships with c_min_attendees=2 for dogfood.
// This seeds exactly 2 attendees on the shared event so we hit the threshold.
// When the threshold is raised to 10 for public launch (see roadmap/01),
// update this scenario to seed 10 attendees.

test("mutual opt-in + attended same event → shared events section renders", async ({
  adminUserId,
  memberPage,
  memberUserId,
  memberAlicePage,
  memberAliceUserId,
  suffix,
}) => {
  const admin = adminClient();
  const now = new Date().toISOString();
  const memberSlug = "member-shared-" + memberUserId.slice(0, 8);
  const aliceSlug = "alice-shared-" + memberAliceUserId.slice(0, 8);

  // Both members opt into discoverable + share_attended_events + share_shared_event_counts.
  const { error: visErr } = await admin.from("profile_visibility_settings").insert([
    {
      user_id: memberUserId,
      discoverable: true,
      share_attended_events: true,
      share_shared_event_counts: true,
      profile_slug: memberSlug,
      last_discoverability_change_at: now,
    },
    {
      user_id: memberAliceUserId,
      discoverable: true,
      share_attended_events: true,
      share_shared_event_counts: true,
      profile_slug: aliceSlug,
      last_discoverability_change_at: now,
    },
  ]);
  if (visErr) throw new Error(`seed visibility: ${visErr.message}`);

  // Seed a past published event both attended. Past because attendance only
  // makes sense for events that have started; status stays 'published' so
  // the helper's status-not-in-draft-archived check passes.
  const eventId = randomUUID();
  const startsAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  const { error: evErr } = await admin.from("events").insert({
    id: eventId,
    slug: "shared-" + suffix,
    title: "Shared Events E2E",
    status: "published",
    visibility: "members",
    starts_at: startsAt,
    ends_at: endsAt,
    is_sensitive: false,
    created_by: adminUserId,
    updated_by: adminUserId,
    published_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  });
  if (evErr) throw new Error(`seed event: ${evErr.message}`);

  const { error: attErr } = await admin.from("event_attendances").insert([
    {
      event_id: eventId,
      user_id: memberUserId,
      method: "admin_click",
      checked_in_by: adminUserId,
    },
    {
      event_id: eventId,
      user_id: memberAliceUserId,
      method: "admin_click",
      checked_in_by: adminUserId,
    },
  ]);
  if (attErr) throw new Error(`seed attendances: ${attErr.message}`);

  // Member visits alice's profile — should see shared events section.
  await memberPage.goto(`/members/${aliceSlug}`);
  await expect(
    memberPage.getByRole("heading", { name: /shared events with you/i })
  ).toBeVisible({ timeout: 10_000 });
  await expect(memberPage.getByText("Shared Events E2E").first()).toBeVisible();

  // Alice visits member's profile — same outcome.
  await memberAlicePage.goto(`/members/${memberSlug}`);
  await expect(
    memberAlicePage.getByRole("heading", { name: /shared events with you/i })
  ).toBeVisible({ timeout: 10_000 });
});
