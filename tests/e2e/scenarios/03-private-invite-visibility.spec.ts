import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// Private-invite events are only viewable by invitees. Non-invitees should
// get a 404 on the detail page (never leak the event's existence via a
// redirect or error message).

test("private_invite: invitee can view, non-invitee 404s", async ({
  adminUserId,
  memberPage,
  memberUserId,
  memberAlicePage,
  suffix,
}) => {
  const admin = adminClient();
  const slug = `priv-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);

  // Seed the private event directly via RPC — keep this test focused on the
  // visibility gate, not on the admin create-form path (scenario 1 covers that).
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week out
  const futureEnd = new Date(future.getTime() + 2 * 60 * 60 * 1000);

  // Use direct inserts — create_event() requires auth.uid() to be an admin,
  // which service-role doesn't have.
  const { data: ev, error: evErr } = await admin
    .from("events")
    .insert({
      slug,
      title: "Private Event E2E",
      status: "published",
      visibility: "private_invite",
      starts_at: future.toISOString(),
      ends_at: futureEnd.toISOString(),
      created_by: adminUserId,
      updated_by: adminUserId,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (evErr || !ev) throw new Error(`seed event: ${evErr?.message}`);
  const eventId = (ev as { id: string }).id;

  // Invite only memberPage's user.
  const { error: inviteErr } = await admin.from("event_invites").insert({
    event_id: eventId,
    user_id: memberUserId,
    invited_by: adminUserId,
  });
  if (inviteErr) throw new Error(`seed invite: ${inviteErr.message}`);

  // Invitee sees the page.
  await memberPage.goto(`/events/${slug}`);
  await expect(
    memberPage.getByRole("heading", { name: "Private Event E2E" })
  ).toBeVisible();

  // Non-invitee gets a 404.
  const response = await memberAlicePage.goto(`/events/${slug}`);
  expect(response?.status()).toBe(404);
});
