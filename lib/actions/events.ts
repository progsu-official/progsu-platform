"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enqueueEventCancellation,
  enqueueEventReminder,
  sendEventRsvpConfirmation,
} from "@/lib/email/events";
import { type ActionResult, err, ok } from "./result";
import {
  cancelEventSchema,
  createEventCoverUploadUrlSchema,
  createEventSchema,
  rsvpToEventSchema,
  updateEventSchema,
  type CreateEventCoverUploadUrlInput,
  type CreateEventInput,
  type RsvpDesired,
  type UpdateEventInput,
} from "./event-schemas";

const EVENT_COVERS_BUCKET = "event-covers";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Map a Supabase/Postgres error to an ActionResult error code.
// - P0001 (raise_exception): business-rule violations from SECURITY DEFINER
//   helpers. We branch on the message for admin/onboarding-style messages to
//   return FORBIDDEN; everything else is INVALID_INPUT so the surface can show
//   the helper's own message inline.
// - P0002 (no_data_found): treated as NOT_FOUND.
// - 23505 (unique_violation): CONFLICT with a curated slug message.
function mapPgError(error: { code?: string | null; message?: string } | null) {
  if (!error) return err("INTERNAL", "Unknown database error.");
  const code = error.code ?? "";
  const msg = error.message ?? "Database error.";

  if (code === "23505") {
    return err("CONFLICT", "Slug already taken.", { field: "slug" });
  }
  if (code === "P0002") {
    return err("NOT_FOUND", msg);
  }
  if (code === "P0001") {
    const lower = msg.toLowerCase();
    if (lower.includes("rate limited")) {
      return err("RATE_LIMITED", msg);
    }
    if (lower.includes("event is full")) {
      return err("CONFLICT", "This event is full.");
    }
    // Treat admin-only / onboarding / auth-shape / visibility / check-in
    // preconditions as FORBIDDEN so member surfaces can surface the specific
    // message verbatim without leaking them into INVALID_INPUT's form-field
    // plumbing.
    if (
      lower.includes("admin only") ||
      lower.includes("not fully onboarded") ||
      lower.includes("unauthenticated") ||
      lower.includes("service_role only") ||
      lower.includes("not visible") ||
      lower.includes("already checked in")
    ) {
      return err("FORBIDDEN", msg);
    }
    return err("INVALID_INPUT", msg);
  }
  return err("INTERNAL", msg);
}

async function requireAdminContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, isAdmin: false as const };
  const { data } = await supabase.rpc("is_admin", { p_user_id: user.id });
  return { supabase, user, isAdmin: data === true };
}

function revalidateEventPaths(eventId?: string) {
  revalidatePath("/admin/events");
  if (eventId) {
    revalidatePath(`/admin/events/${eventId}`);
  }
}

export async function createEvent(
  rawInput: CreateEventInput
): Promise<ActionResult<{ eventId: string }>> {
  const parsed = createEventSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const data = parsed.data;

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const payload = {
    slug: data.slug,
    title: data.title,
    description_md: data.description_md,
    visibility: data.visibility,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    location_text: data.location_text,
    location_url: data.location_url,
    capacity: data.capacity,
    waitlist_enabled: data.waitlist_enabled,
    is_sensitive: data.is_sensitive,
    send_rsvp_email: data.send_rsvp_email,
    send_reminder_email: data.send_reminder_email,
    cover_image_path: data.cover_image_path,
    hosts: data.hosts.map((h, i) => ({
      display_name: h.display_name,
      profile_id: h.profile_id,
      sort_order: i,
    })),
  };

  const { data: eventId, error } = await supabase.rpc("create_event", {
    p_payload: payload,
  });
  if (error) return mapPgError(error);
  if (!eventId || typeof eventId !== "string") {
    return err("INTERNAL", "Event created but id missing.");
  }

  revalidateEventPaths(eventId);
  return ok({ eventId });
}

export async function updateEvent(
  eventId: string,
  rawPatch: UpdateEventInput
): Promise<ActionResult<{ updated: true }>> {
  const idParsed = z.string().uuid().safeParse(eventId);
  if (!idParsed.success) return err("INVALID_INPUT", "Invalid event id.");

  const parsed = updateEventSchema.safeParse(rawPatch);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  // Build a patch containing only the keys the caller actually supplied so
  // DB-side `coalesce(p_patch ->> 'key', ...)` doesn't overwrite omitted
  // columns with nulls.
  const patch: Record<string, unknown> = {};
  const raw = rawPatch as Record<string, unknown>;
  const out = parsed.data as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    // Include the key only if the input explicitly had that key — zod's
    // defaults/transforms can otherwise fabricate keys on us.
    if (key in raw) patch[key] = out[key];
  }
  // hosts is special: the DB replaces the host list whenever the key is present.
  if (patch.hosts && Array.isArray(patch.hosts)) {
    patch.hosts = (patch.hosts as Array<{ display_name: string; profile_id: string | null }>).map(
      (h, i) => ({
        display_name: h.display_name,
        profile_id: h.profile_id,
        sort_order: i,
      })
    );
  }

  const { error } = await supabase.rpc("update_event", {
    p_event_id: eventId,
    p_patch: patch,
  });
  if (error) return mapPgError(error);

  revalidateEventPaths(eventId);
  return ok({ updated: true });
}

export async function publishEvent(
  eventId: string
): Promise<ActionResult<{ published: true }>> {
  const idParsed = z.string().uuid().safeParse(eventId);
  if (!idParsed.success) return err("INVALID_INPUT", "Invalid event id.");

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("publish_event", { p_event_id: eventId });
  if (error) return mapPgError(error);

  // Fire-and-forget: enqueue reminder jobs for any currently-going RSVPs.
  // Events published >24h before start land here; the reminder worker cron
  // also scans the 20-30h window so shorter-notice publishes are caught
  // redundantly.
  void enqueueEventReminder({ eventId }).catch((e) => {
    console.error("[events] enqueueEventReminder failed:", e);
  });

  revalidateEventPaths(eventId);
  return ok({ published: true });
}

export async function cancelEvent(
  eventId: string,
  rawInput: { reason: string }
): Promise<ActionResult<{ cancelled: true }>> {
  const idParsed = z.string().uuid().safeParse(eventId);
  if (!idParsed.success) return err("INVALID_INPUT", "Invalid event id.");

  const parsed = cancelEventSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Reason required.",
      { field: "reason" }
    );
  }

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("cancel_event", {
    p_event_id: eventId,
    p_reason: parsed.data.reason,
  });
  if (error) return mapPgError(error);

  // Fire-and-forget: fan out cancellation emails to all going/waitlisted
  // RSVPs and anyone who had checked in (for events cancelled post-start).
  void enqueueEventCancellation({ eventId }).catch((e) => {
    console.error("[events] enqueueEventCancellation failed:", e);
  });

  revalidateEventPaths(eventId);
  return ok({ cancelled: true });
}

export async function archiveEvent(
  eventId: string
): Promise<ActionResult<{ archived: true }>> {
  const idParsed = z.string().uuid().safeParse(eventId);
  if (!idParsed.success) return err("INVALID_INPUT", "Invalid event id.");

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("archive_event", { p_event_id: eventId });
  if (error) return mapPgError(error);

  revalidateEventPaths(eventId);
  return ok({ archived: true });
}

export async function deleteDraftEvent(
  eventId: string
): Promise<ActionResult<{ deleted: true }>> {
  const idParsed = z.string().uuid().safeParse(eventId);
  if (!idParsed.success) return err("INVALID_INPUT", "Invalid event id.");

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("delete_draft_event", {
    p_event_id: eventId,
  });
  if (error) return mapPgError(error);

  revalidateEventPaths();
  return ok({ deleted: true });
}

export async function inviteMember(
  eventId: string,
  userId: string
): Promise<ActionResult<{ invited: true }>> {
  const parsed = z
    .object({ eventId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ eventId, userId });
  if (!parsed.success) return err("INVALID_INPUT", "Invalid ids.");

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("invite_member_to_event", {
    p_event_id: eventId,
    p_user_id: userId,
  });
  if (error) return mapPgError(error);

  revalidateEventPaths(eventId);
  return ok({ invited: true });
}

export async function revokeInvite(
  eventId: string,
  userId: string
): Promise<ActionResult<{ revoked: true }>> {
  const parsed = z
    .object({ eventId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ eventId, userId });
  if (!parsed.success) return err("INVALID_INPUT", "Invalid ids.");

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("revoke_event_invite", {
    p_event_id: eventId,
    p_user_id: userId,
  });
  if (error) return mapPgError(error);

  revalidateEventPaths(eventId);
  return ok({ revoked: true });
}

export async function promoteWaitlistedMember(
  eventId: string,
  userId: string
): Promise<ActionResult<{ promoted: true }>> {
  const parsed = z
    .object({ eventId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ eventId, userId });
  if (!parsed.success) return err("INVALID_INPUT", "Invalid ids.");

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("promote_waitlisted_member", {
    p_event_id: eventId,
    p_user_id: userId,
  });
  if (error) return mapPgError(error);

  revalidateEventPaths(eventId);
  return ok({ promoted: true });
}

const adminCheckInSchema = z.object({
  eventId: z.string().uuid(),
  userId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function adminCheckIn(
  eventId: string,
  userId: string,
  note?: string | null
): Promise<ActionResult<{ checkedIn: true }>> {
  const parsed = adminCheckInSchema.safeParse({ eventId, userId, note });
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid input"
    );
  }

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("admin_check_in_member", {
    p_event_id: parsed.data.eventId,
    p_user_id: parsed.data.userId,
    p_note: parsed.data.note ?? null,
  });
  if (error) return mapPgError(error);

  revalidateEventPaths(parsed.data.eventId);
  return ok({ checkedIn: true });
}

const adminCheckInByTokenSchema = z.object({
  token: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
});

// D12/§7.5: QR check-in. Staff's browser decodes the scanned QR into a raw
// token string; this resolves it to (event_id, user_id) and writes through
// the same event_attendances insert path as adminCheckIn above, just via
// admin_check_in_by_token instead of admin_check_in_member.
export async function adminCheckInByToken(
  token: string,
  note?: string | null
): Promise<ActionResult<{ eventId: string; userId: string }>> {
  const parsed = adminCheckInByTokenSchema.safeParse({ token, note });
  if (!parsed.success) {
    return err("INVALID_INPUT", "That doesn't look like a valid QR code.");
  }

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { data, error } = await supabase.rpc("admin_check_in_by_token", {
    p_token: parsed.data.token,
    p_note: parsed.data.note ?? null,
  });
  if (error) return mapPgError(error);

  const row = Array.isArray(data) ? data[0] : data;
  const eventId = row?.out_event_id as string | undefined;
  const userId = row?.out_user_id as string | undefined;
  if (!eventId || !userId) return err("INTERNAL", "Check-in did not return a result.");

  revalidateEventPaths(eventId);
  return ok({ eventId, userId });
}

const correctAttendanceSchema = z.object({
  eventId: z.string().uuid(),
  userId: z.string().uuid(),
  action: z.enum(["set", "remove", "update_note"]),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function correctAttendance(
  eventId: string,
  userId: string,
  action: "set" | "remove" | "update_note",
  note?: string | null
): Promise<ActionResult<{ corrected: true }>> {
  const parsed = correctAttendanceSchema.safeParse({
    eventId,
    userId,
    action,
    note,
  });
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid input"
    );
  }

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { error } = await supabase.rpc("correct_attendance", {
    p_event_id: parsed.data.eventId,
    p_user_id: parsed.data.userId,
    p_action: parsed.data.action,
    p_note: parsed.data.note ?? null,
  });
  if (error) return mapPgError(error);

  revalidateEventPaths(parsed.data.eventId);
  return ok({ corrected: true });
}

// =====================================================================
// Member actions (below the admin set). These share mapPgError above
// and intentionally use the user-context `createClient()` — never the
// admin client — so all reads/writes run through RLS + SECURITY DEFINER
// guards.
// =====================================================================

async function requireAuthenticatedContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function revalidateMemberEventPaths(slug?: string) {
  revalidatePath("/events");
  revalidatePath("/profile");
  if (slug) {
    revalidatePath(`/events/${slug}`);
    revalidatePath(`/events/${slug}/check-in`);
  }
}

type EffectiveRsvpStatus = "going" | "waitlisted" | "declined" | "cancelled";

export async function rsvpToEvent(
  eventId: string,
  desired: RsvpDesired,
  comment?: string
): Promise<ActionResult<{ effectiveStatus: EffectiveRsvpStatus }>> {
  const parsed = rsvpToEventSchema.safeParse({ eventId, desired, comment });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }

  const { supabase, user } = await requireAuthenticatedContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  // Read prior RSVP state + event's send_rsvp_email flag so we can decide
  // whether to fire a confirmation email after the RPC. RLS on event_rsvps
  // is self-only; events is readable via can_view_event.
  const [{ data: priorRsvp }, { data: eventRow }] = await Promise.all([
    supabase
      .from("event_rsvps")
      .select("status")
      .eq("event_id", parsed.data.eventId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("events")
      .select("send_rsvp_email")
      .eq("id", parsed.data.eventId)
      .maybeSingle(),
  ]);

  const { data, error } = await supabase.rpc("rsvp_to_event", {
    p_event_id: parsed.data.eventId,
    p_desired: parsed.data.desired,
    p_comment: parsed.data.comment ?? null,
  });
  if (error) return mapPgError(error);

  const status = typeof data === "string" ? (data as EffectiveRsvpStatus) : null;
  if (!status) {
    return err("INTERNAL", "RSVP saved but effective status missing.");
  }

  // Fire-and-forget: confirmation email only on transition INTO 'going' and
  // only when the event has send_rsvp_email = true. Don't await — the user
  // shouldn't wait for SMTP before seeing their RSVP succeed.
  const previousStatus = priorRsvp?.status ?? null;
  if (
    status === "going" &&
    previousStatus !== "going" &&
    eventRow?.send_rsvp_email === true
  ) {
    void sendEventRsvpConfirmation({
      eventId: parsed.data.eventId,
      userId: user.id,
    }).catch((e) => {
      console.error("[events] rsvp confirmation send failed:", e);
    });
  }

  // We don't have the slug here (RPC only returns status); revalidate the
  // /events list + dashboard unconditionally and let the detail page
  // revalidate via its own server render on the next visit.
  revalidateMemberEventPaths();
  return ok({ effectiveStatus: status });
}

// ---------------------------------------------------------------------------
// Invite by email
// ---------------------------------------------------------------------------

// Resolves an email address to a profile id (matching either google_email or
// student_email) and invites them. Single round-trip for the admin UX.
// Returns the resolved user_id so the caller can show a confirmation.
export async function inviteMemberByEmail(
  eventId: string,
  rawEmail: string
): Promise<ActionResult<{ userId: string; email: string }>> {
  const idParsed = z.string().uuid().safeParse(eventId);
  if (!idParsed.success) return err("INVALID_INPUT", "Invalid event id.");

  const emailParsed = z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address.")
    .safeParse(rawEmail);
  if (!emailParsed.success) {
    return err("INVALID_INPUT", emailParsed.error.issues[0]?.message ?? "Invalid email.");
  }
  const email = emailParsed.data;

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  // Admin RLS on profiles allows SELECT; use the user-context client so the
  // read is audited under this admin's session, not service-role.
  const { data: match, error: lookupErr } = await supabase
    .from("profiles")
    .select("id, google_email, student_email")
    .or(`google_email.eq.${email},student_email.eq.${email}`)
    .limit(1)
    .maybeSingle();
  if (lookupErr) return err("INTERNAL", lookupErr.message);
  if (!match) {
    return err(
      "NOT_FOUND",
      "No member with that email. They need to sign in at least once before you can invite them.",
      { field: "email" }
    );
  }

  const { error } = await supabase.rpc("invite_member_to_event", {
    p_event_id: eventId,
    p_user_id: match.id,
  });
  if (error) return mapPgError(error);

  revalidateEventPaths(eventId);
  return ok({ userId: match.id as string, email });
}

// ---------------------------------------------------------------------------
// Cover image upload
// ---------------------------------------------------------------------------

// Mints a signed upload URL for an event cover. The client does the actual
// upload (direct-to-storage POST), then calls updateEvent({cover_image_path})
// separately to persist the path on the event row. Separation keeps a failed
// upload from corrupting the event row and lets cover replacement reuse the
// same flow without a transaction.
//
// Storage RLS (migration 1): INSERT/UPDATE/DELETE on event-covers is gated on
// public.is_admin(auth.uid()). We double-gate at the action layer to return
// a friendly error before touching storage.
export async function createEventCoverUploadUrl(
  rawInput: CreateEventCoverUploadUrlInput
): Promise<
  ActionResult<{ path: string; signedUrl: string; token: string }>
> {
  const parsed = createEventCoverUploadUrlSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid input", {
      field: first?.path.join("."),
    });
  }
  const { eventId, contentType, fileSize } = parsed.data;

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  // Verify the event exists so we don't sign a URL for a bad id.
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) return err("INTERNAL", eventErr.message);
  if (!event) return err("NOT_FOUND", "Event not found.");

  const ext = MIME_TO_EXT[contentType];
  if (!ext) return err("INVALID_INPUT", "Unsupported image type.");
  const path = `${eventId}/${randomUUID()}.${ext}`;

  const { data: signed, error: signErr } = await supabase.storage
    .from(EVENT_COVERS_BUCKET)
    .createSignedUploadUrl(path);
  if (signErr || !signed) {
    return err(
      "INTERNAL",
      signErr?.message ?? "Could not sign cover upload URL."
    );
  }

  // fileSize is sanity-checked at the schema layer; storage also enforces
  // the 5 MB bucket limit server-side. We don't persist the size here —
  // the event row doesn't track cover metadata beyond the path.
  void fileSize;

  return ok({ path, signedUrl: signed.signedUrl, token: signed.token });
}

// Removes the cover: deletes the storage object (via service-role so we
// don't depend on the admin's own storage policy) and clears
// events.cover_image_path via update_event. Safe to call when no cover is
// set (no-op).
export async function deleteEventCover(
  eventId: string
): Promise<ActionResult<{ cleared: true }>> {
  const idParsed = z.string().uuid().safeParse(eventId);
  if (!idParsed.success) return err("INVALID_INPUT", "Invalid event id.");

  const { supabase, user, isAdmin } = await requireAdminContext();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");
  if (!isAdmin) return err("FORBIDDEN", "Admins only.");

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, cover_image_path")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) return err("INTERNAL", eventErr.message);
  if (!event) return err("NOT_FOUND", "Event not found.");

  const existing = (event as { cover_image_path: string | null })
    .cover_image_path;

  if (existing) {
    const admin = createAdminClient();
    // Ignore individual remove errors — a missing object is fine, and we
    // still want to clear the path on the event row below.
    await admin.storage.from(EVENT_COVERS_BUCKET).remove([existing]);
  }

  const { error: updateErr } = await supabase.rpc("update_event", {
    p_event_id: eventId,
    p_patch: { cover_image_path: null },
  });
  if (updateErr) return mapPgError(updateErr);

  revalidateEventPaths(eventId);
  return ok({ cleared: true });
}
