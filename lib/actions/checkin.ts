"use server";

import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffCheckinToken } from "@/lib/env";
import { type ActionResult, err, ok } from "./result";

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
    return err("UNAUTHORIZED", "That code is not valid.");
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
  jar.delete(COOKIE_NAME);
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
