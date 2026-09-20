"use server";

import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffCheckinToken } from "@/lib/env";
import { type ActionResult, err, ok } from "./result";
import type { AttendeeRow } from "@/app/admin/events/[id]/_components/attendee-table";

// Door-staff check-in: no Supabase Auth account, just a shared secret you
// hand out (STAFF_CHECKIN_TOKEN). Holding the cookie below is the entire
// authorization model for this surface — see
// staff_check_in_by_token() in supabase/migrations for the matching
// service_role-only RPC grant.
const COOKIE_NAME = "staff_checkin_token";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function isStaffCheckinAuthed(): Promise<boolean> {
  const jar = await cookies();
  const value = jar.get(COOKIE_NAME)?.value;
  if (!value) return false;
  try {
    return constantTimeEqual(value, requireStaffCheckinToken());
  } catch {
    return false;
  }
}

export async function staffCheckinLogin(
  token: string
): Promise<ActionResult<{ ok: true }>> {
  let expected: string;
  try {
    expected = requireStaffCheckinToken();
  } catch {
    return err("INTERNAL", "Check-in is not configured yet.");
  }
  if (!constantTimeEqual(token.trim(), expected)) {
    return err("UNAUTHORIZED", "That token is not valid.");
  }

  const jar = await cookies();
  jar.set(COOKIE_NAME, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/checkin",
    // A door shift, not a session to keep alive across days.
    maxAge: 60 * 60 * 12,
  });
  return ok({ ok: true });
}

export async function staffCheckinLogout(): Promise<void> {
  const jar = await cookies();
  // Must match the cookie's original path — deleting without it defaults to
  // "/", which sets an unrelated cookie and leaves the real one (scoped to
  // "/checkin") still attached to every request here.
  jar.delete({ name: COOKIE_NAME, path: "/checkin" });
}

const staffCheckInByTokenSchema = z.object({
  token: z.string().uuid(),
  eventId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function staffCheckInByToken(
  token: string,
  eventId: string,
  note?: string | null
): Promise<ActionResult<{ eventId: string; userId: string | null }>> {
  if (!(await isStaffCheckinAuthed())) {
    return err("UNAUTHORIZED", "Sign in required.");
  }

  const parsed = staffCheckInByTokenSchema.safeParse({ token, eventId, note });
  if (!parsed.success) {
    return err("INVALID_INPUT", "That doesn't look like a valid QR code.");
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("staff_check_in_by_token", {
    p_token: parsed.data.token,
    p_note: parsed.data.note ?? null,
    p_event_id: parsed.data.eventId,
  });
  if (error) {
    const msg = error.message ?? "Database error.";
    if (msg.toLowerCase().includes("already checked in")) {
      return err("FORBIDDEN", msg);
    }
    return err("INVALID_INPUT", msg);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const outEventId = row?.out_event_id as string | undefined;
  const userId = (row?.out_user_id as string | null | undefined) ?? null;
  if (!outEventId) return err("INTERNAL", "Check-in did not return a result.");

  return ok({ eventId: outEventId, userId });
}

// Search list for door staff — no admin session, so actions here (below)
// stay limited to check-in only, no remove/promote. See
// staff_event_attendees_for() for what it deliberately leaves out (invites,
// waitlist position, historical attendees).
export async function staffEventAttendees(
  eventId: string
): Promise<ActionResult<AttendeeRow[]>> {
  if (!(await isStaffCheckinAuthed())) {
    return err("UNAUTHORIZED", "Sign in required.");
  }
  if (!z.string().uuid().safeParse(eventId).success) {
    return err("INVALID_INPUT", "Invalid event.");
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("staff_event_attendees_for", {
    p_event_id: eventId,
  });
  if (error) return err("INTERNAL", error.message);

  const rows = (data ?? []) as Array<{
    id: string;
    kind: "member" | "guest";
    name: string;
    email: string | null;
    status: string | null;
    checked_in: boolean;
    checked_in_at: string | null;
    checkin_token: string | null;
  }>;

  return ok(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      email: r.email,
      status: r.status,
      checkedIn: r.checked_in,
      checkedInAt: r.checked_in_at,
      checkinToken: r.checkin_token,
    }))
  );
}

const staffCheckInMemberSchema = z.object({
  eventId: z.string().uuid(),
  userId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
});

// Manual walk-in for a member, no QR needed — mirrors admin_check_in_member's
// upsert/no-RSVP-required behavior, just under the staff-token trust model
// instead of an admin session. Guests don't get an equivalent here: their
// checkin_token is returned by staffEventAttendees above, so a manual guest
// check-in reuses staffCheckInByToken directly (same as the admin tab).
export async function staffCheckInMember(
  eventId: string,
  userId: string,
  note?: string | null
): Promise<ActionResult<{ checkedIn: true }>> {
  if (!(await isStaffCheckinAuthed())) {
    return err("UNAUTHORIZED", "Sign in required.");
  }

  const parsed = staffCheckInMemberSchema.safeParse({ eventId, userId, note });
  if (!parsed.success) {
    return err("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("staff_check_in_member", {
    p_event_id: parsed.data.eventId,
    p_user_id: parsed.data.userId,
    p_note: parsed.data.note ?? null,
  });
  if (error) return err("INVALID_INPUT", error.message ?? "Database error.");

  return ok({ checkedIn: true });
}

const staffRemoveCheckInSchema = z.object({
  eventId: z.string().uuid(),
  userId: z.string().uuid(),
});

// Undo a member's check-in from the door — mirrors correctAttendance's
// "remove" action, staff-token trust model instead of an admin session.
export async function staffRemoveCheckIn(
  eventId: string,
  userId: string
): Promise<ActionResult<{ removed: true }>> {
  if (!(await isStaffCheckinAuthed())) {
    return err("UNAUTHORIZED", "Sign in required.");
  }

  const parsed = staffRemoveCheckInSchema.safeParse({ eventId, userId });
  if (!parsed.success) return err("INVALID_INPUT", "Invalid ids.");

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("staff_remove_check_in", {
    p_event_id: parsed.data.eventId,
    p_user_id: parsed.data.userId,
  });
  if (error) return err("INVALID_INPUT", error.message ?? "Database error.");

  return ok({ removed: true });
}

const staffRemoveGuestCheckInSchema = z.object({
  eventId: z.string().uuid(),
  guestRsvpId: z.string().uuid(),
});

// Undo a guest's check-in — mirrors correctGuestAttendance, staff-token
// trust model instead of an admin session.
export async function staffRemoveGuestCheckIn(
  eventId: string,
  guestRsvpId: string
): Promise<ActionResult<{ removed: true }>> {
  if (!(await isStaffCheckinAuthed())) {
    return err("UNAUTHORIZED", "Sign in required.");
  }

  const parsed = staffRemoveGuestCheckInSchema.safeParse({
    eventId,
    guestRsvpId,
  });
  if (!parsed.success) return err("INVALID_INPUT", "Invalid ids.");

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("staff_remove_guest_check_in", {
    p_event_id: parsed.data.eventId,
    p_guest_rsvp_id: parsed.data.guestRsvpId,
  });
  if (error) return err("INVALID_INPUT", error.message ?? "Database error.");

  return ok({ removed: true });
}
