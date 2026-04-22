import { randomUUID } from "node:crypto";

import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// Admin cancels an event with a reason. Every member with going/waitlisted
// RSVP or an attendance row gets a cancellation email enqueued. We verify
// via event_notification_jobs (the source of truth) rather than tailing the
// dev server's log transport — cleaner and doesn't depend on log format.

test("cancel event with reason enqueues cancellation jobs for RSVP'd members", async ({
  adminUserId,
  adminPage,
  memberUserId,
  memberAliceUserId,
  suffix,
}) => {
  const admin = adminClient();
  const eventId = randomUUID();
  const slug = "cancel-" + suffix;
  const starts = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const ends = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();

  // Seed an event with two RSVPs.
  const { error: evErr } = await admin.from("events").insert({
    id: eventId,
    slug,
    title: "Will Be Cancelled",
    status: "published",
    visibility: "members",
    starts_at: starts,
    ends_at: ends,
    created_by: adminUserId,
    updated_by: adminUserId,
    published_at: new Date().toISOString(),
  });
  if (evErr) throw new Error(`seed event: ${evErr.message}`);

  const { error: rsvpErr } = await admin.from("event_rsvps").insert([
    {
      event_id: eventId,
      user_id: memberUserId,
      status: "going",
    },
    {
      event_id: eventId,
      user_id: memberAliceUserId,
      status: "going",
    },
  ]);
  if (rsvpErr) throw new Error(`seed rsvps: ${rsvpErr.message}`);

  // Admin navigates to the event and cancels it via the UI.
  await adminPage.goto(`/admin/events/${eventId}`);
  await adminPage.getByRole("button", { name: /cancel event/i }).click();
  // The cancel flow now opens an inline panel with a textarea.
  const reasonField = adminPage.getByLabel(/reason/i).first();
  await reasonField.fill("E2E test cancellation.");
  await adminPage.getByRole("button", { name: /^confirm cancel$|^cancel event$/i }).last().click();

  // Poll: event should be cancelled and cancellation jobs enqueued for both
  // RSVP'd members. Enqueue happens inline in the cancelEvent server action.
  await expect
    .poll(
      async () => {
        const { data: event } = await admin
          .from("events")
          .select("status")
          .eq("id", eventId)
          .single();
        return (event as { status: string } | null)?.status;
      },
      { timeout: 15_000, message: "event should be cancelled" }
    )
    .toBe("cancelled");

  await expect
    .poll(
      async () => {
        const { count } = await admin
          .from("event_notification_jobs")
          .select("*", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("kind", "cancellation");
        return count ?? -1;
      },
      { timeout: 15_000, message: "two cancellation jobs should be enqueued" }
    )
    .toBe(2);
});
