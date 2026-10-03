"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, err, ok } from "./result";

// Admin controls for the mobile-era features: per-event points, staff
// assignments, point adjustments, announcements, and the Hacklanta guide.
// Every privileged write goes through a SECURITY DEFINER helper that checks
// is_admin() itself and audits with the real actor; the Hacklanta tables are
// admin-RLS and audited by trigger.

async function adminContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.rpc("is_admin", { p_user_id: user.id });
  return data === true ? { supabase, user } : null;
}

function dbErr(error: { code?: string; message?: string }): ActionResult<never> {
  const msg = (error.message ?? "Database error.").replace(/^[a-z_]+: /, "");
  if (error.code === "P0002") return err("NOT_FOUND", msg);
  if (error.code === "P0001") return err("INVALID_INPUT", msg);
  if (error.code === "23505") return err("CONFLICT", "That already exists.");
  if (error.code === "42501") return err("FORBIDDEN", "Not allowed.");
  return err("INTERNAL", msg);
}

function firstIssue(e: z.ZodError): ActionResult<never> {
  const i = e.issues[0];
  return err("INVALID_INPUT", i?.message ?? "Invalid input", { field: i?.path.join(".") });
}

// ------------------------------------------------------------------ points
const pointsSchema = z.object({
  eventId: z.string().uuid(),
  points: z.number().int().min(0).max(10000).nullable(),
});

export async function setEventPoints(input: z.input<typeof pointsSchema>): Promise<ActionResult<{ points: number | null }>> {
  const parsed = pointsSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const { error } = await ctx.supabase.rpc("admin_set_event_points", {
    p_event_id: parsed.data.eventId,
    p_points: parsed.data.points,
  });
  if (error) return dbErr(error);
  revalidatePath(`/admin/events/${parsed.data.eventId}`);
  return ok({ points: parsed.data.points });
}

const adjustSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  amount: z.number().int().min(-10000).max(10000).refine((n) => n !== 0, "Amount can't be zero"),
  reason: z.string().trim().min(3, "Give a reason").max(500),
  eventId: z.string().uuid().nullable(),
});

async function profileIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .or(`google_email.eq.${email},student_email.eq.${email}`)
    .limit(2);
  return data && data.length === 1 ? String(data[0].id) : null;
}

export async function adjustMemberPoints(input: z.input<typeof adjustSchema>): Promise<ActionResult<{ ledgerId: string }>> {
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const userId = await profileIdByEmail(parsed.data.email);
  if (!userId) return err("NOT_FOUND", "No single member matches that email.", { field: "email" });
  const { data, error } = await ctx.supabase.rpc("admin_adjust_points", {
    p_user_id: userId,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
    p_event_id: parsed.data.eventId,
  });
  if (error) return dbErr(error);
  if (parsed.data.eventId) revalidatePath(`/admin/events/${parsed.data.eventId}`);
  return ok({ ledgerId: String(data) });
}

// ------------------------------------------------------------------ staff
const grantSchema = z.object({
  eventId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
});

export async function grantEventStaff(input: z.input<typeof grantSchema>): Promise<ActionResult<{ userId: string }>> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const userId = await profileIdByEmail(parsed.data.email);
  if (!userId) return err("NOT_FOUND", "No single member matches that email.", { field: "email" });
  const { error } = await ctx.supabase.rpc("admin_grant_event_staff", {
    p_event_id: parsed.data.eventId,
    p_user_id: userId,
    p_expires_at: parsed.data.expiresAt,
  });
  if (error) return dbErr(error);
  revalidatePath(`/admin/events/${parsed.data.eventId}`);
  return ok({ userId });
}

export async function revokeEventStaff(eventId: string, userId: string): Promise<ActionResult<{ revoked: boolean }>> {
  const parsed = z.object({ eventId: z.string().uuid(), userId: z.string().uuid() }).safeParse({ eventId, userId });
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const { data, error } = await ctx.supabase.rpc("admin_revoke_event_staff", {
    p_event_id: eventId,
    p_user_id: userId,
  });
  if (error) return dbErr(error);
  revalidatePath(`/admin/events/${eventId}`);
  return ok({ revoked: data === true });
}

// ------------------------------------------------------------------ announcements
const announcementSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
    audience: z.enum(["all", "event_rsvps", "hacklanta"]),
    eventId: z.string().uuid().nullable(),
    priority: z.enum(["normal", "important"]),
    deepLink: z
      .string()
      .trim()
      .max(500)
      .regex(/^(progsu:\/\/|https:\/\/)/, "Deep link must start with progsu:// or https://")
      .nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    push: z.boolean(),
  })
  .refine((v) => v.audience !== "event_rsvps" || v.eventId, {
    message: "Pick an event for an RSVP audience",
    path: ["eventId"],
  });

export async function publishAnnouncement(
  input: z.input<typeof announcementSchema>
): Promise<ActionResult<{ id: string; queued: number }>> {
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc("admin_publish_announcement", {
    p_title: v.title,
    p_body: v.body,
    p_audience: v.audience,
    p_event_id: v.eventId,
    p_priority: v.priority,
    p_deep_link: v.deepLink,
    p_expires_at: v.expiresAt,
    p_push: v.push,
  });
  if (error) return dbErr(error);
  const row = (data ?? [])[0] as { announcement_id: string; queued: number } | undefined;
  revalidatePath("/admin/announcements");
  return ok({ id: String(row?.announcement_id), queued: Number(row?.queued ?? 0) });
}

export async function unpublishAnnouncement(id: string): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(id).success) return err("INVALID_INPUT", "Bad id.");
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const { error } = await ctx.supabase.rpc("admin_unpublish_announcement", { p_id: id });
  if (error) return dbErr(error);
  revalidatePath("/admin/announcements");
  return ok({ id });
}

// ------------------------------------------------------------------ hacklanta
const editionSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    timeZone: z.string().trim().min(1).max(64),
    venueName: z.string().trim().max(200).nullable(),
    venueAddress: z.string().trim().max(500).nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    themeOverride: z.enum(["auto", "force_on", "force_off"]),
    scheduleTentative: z.boolean(),
    published: z.boolean(),
  })
  .refine((v) => Date.parse(v.startsAt) < Date.parse(v.endsAt), {
    message: "End must be after start",
    path: ["endsAt"],
  });

export async function saveHacklantaEdition(input: z.input<typeof editionSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = editionSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const v = parsed.data;
  const { data: cur } = await ctx.supabase
    .from("hacklanta_editions")
    .select("published_at")
    .eq("id", v.id)
    .maybeSingle();
  if (!cur) return err("NOT_FOUND", "Edition not found.");
  const { error } = await ctx.supabase
    .from("hacklanta_editions")
    .update({
      name: v.name,
      starts_at: v.startsAt,
      ends_at: v.endsAt,
      time_zone: v.timeZone,
      venue_name: v.venueName,
      venue_address: v.venueAddress,
      lat: v.lat,
      lng: v.lng,
      theme_override: v.themeOverride,
      schedule_tentative: v.scheduleTentative,
      published_at: v.published ? (cur.published_at ?? new Date().toISOString()) : null,
    })
    .eq("id", v.id);
  if (error) return dbErr(error);
  revalidatePath("/admin/hacklanta");
  return ok({ id: v.id });
}

const floorSchema = z.object({
  editionId: z.string().uuid(),
  floorId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(80),
  sort: z.number().int().min(-1000).max(1000),
});

const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function saveHacklantaFloor(
  input: z.input<typeof floorSchema>,
  image: File | null
): Promise<ActionResult<{ id: string }>> {
  const parsed = floorSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const v = parsed.data;

  let floorId = v.floorId;
  let version = 1;
  if (floorId) {
    const { data: cur } = await ctx.supabase.from("hacklanta_floors").select("version").eq("id", floorId).maybeSingle();
    if (!cur) return err("NOT_FOUND", "Floor not found.");
    version = Number(cur.version);
    const { error } = await ctx.supabase.from("hacklanta_floors").update({ name: v.name, sort: v.sort }).eq("id", floorId);
    if (error) return dbErr(error);
  } else {
    const { data, error } = await ctx.supabase
      .from("hacklanta_floors")
      .insert({ edition_id: v.editionId, name: v.name, sort: v.sort })
      .select("id")
      .single();
    if (error || !data) return dbErr(error ?? {});
    floorId = String(data.id);
  }

  if (image && image.size > 0) {
    const ext = IMAGE_EXT[image.type];
    if (!ext) return err("INVALID_INPUT", "Floor image must be PNG, JPEG or WebP.", { field: "image" });
    if (image.size > 5 * 1024 * 1024) return err("INVALID_INPUT", "Floor image must be 5 MB or smaller.", { field: "image" });
    const nextVersion = v.floorId ? version + 1 : 1;
    const path = `${v.editionId}/${floorId}-v${nextVersion}.${ext}`;
    const { error: upErr } = await ctx.supabase.storage
      .from("hacklanta-floors")
      .upload(path, image, { contentType: image.type, upsert: true });
    if (upErr) return err("INTERNAL", upErr.message);
    const { error } = await ctx.supabase
      .from("hacklanta_floors")
      .update({ image_path: path, version: nextVersion })
      .eq("id", floorId);
    if (error) return dbErr(error);
  }
  revalidatePath("/admin/hacklanta");
  return ok({ id: floorId });
}

const roomSchema = z.object({
  editionId: z.string().uuid(),
  roomId: z.string().uuid().nullable(),
  floorId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().regex(/^[a-z_]{1,32}$/, "kind: lowercase letters and _"),
  description: z.string().trim().max(1000).nullable(),
  x: z.number().min(0).max(1).nullable(),
  y: z.number().min(0).max(1).nullable(),
});

export async function saveHacklantaRoom(input: z.input<typeof roomSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const v = parsed.data;
  const row = {
    edition_id: v.editionId,
    floor_id: v.floorId,
    name: v.name,
    kind: v.kind,
    description: v.description,
    x: v.x,
    y: v.y,
  };
  const q = v.roomId
    ? ctx.supabase.from("hacklanta_rooms").update(row).eq("id", v.roomId).select("id").single()
    : ctx.supabase.from("hacklanta_rooms").insert(row).select("id").single();
  const { data, error } = await q;
  if (error || !data) return dbErr(error ?? {});
  revalidatePath("/admin/hacklanta");
  return ok({ id: String(data.id) });
}

const sessionSchema = z
  .object({
    editionId: z.string().uuid(),
    sessionId: z.string().uuid().nullable(),
    key: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "key: lowercase letters, digits, dashes"),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullable(),
    kind: z.string().trim().regex(/^[a-z_]{1,32}$/, "kind: lowercase letters and _"),
    track: z.string().trim().max(80).nullable(),
    roomId: z.string().uuid().nullable(),
    roomLabel: z.string().trim().max(120).nullable(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).nullable(),
    status: z.enum(["scheduled", "cancelled", "moved"]),
    pointsNote: z.string().trim().max(200).nullable(),
  })
  .refine((v) => !v.endsAt || Date.parse(v.startsAt) < Date.parse(v.endsAt), {
    message: "End must be after start",
    path: ["endsAt"],
  });

export async function saveHacklantaSession(input: z.input<typeof sessionSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = sessionSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const v = parsed.data;
  const row = {
    edition_id: v.editionId,
    key: v.key,
    title: v.title,
    description: v.description,
    kind: v.kind,
    track: v.track,
    room_id: v.roomId,
    room_label: v.roomLabel,
    starts_at: v.startsAt,
    ends_at: v.endsAt,
    status: v.status,
    points_note: v.pointsNote,
  };
  const q = v.sessionId
    ? ctx.supabase.from("hacklanta_sessions").update(row).eq("id", v.sessionId).select("id").single()
    : ctx.supabase.from("hacklanta_sessions").insert(row).select("id").single();
  const { data, error } = await q;
  if (error || !data) return dbErr(error ?? {});
  revalidatePath("/admin/hacklanta");
  return ok({ id: String(data.id) });
}

export async function deleteHacklantaItem(
  table: "floors" | "rooms" | "sessions",
  id: string
): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(id).success) return err("INVALID_INPUT", "Bad id.");
  if (!["floors", "rooms", "sessions"].includes(table)) return err("INVALID_INPUT", "Bad table.");
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const { error } = await ctx.supabase.from(`hacklanta_${table}`).delete().eq("id", id);
  if (error) return dbErr(error);
  revalidatePath("/admin/hacklanta");
  return ok({ id });
}

const createEditionSchema = z
  .object({
    slug: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "slug: lowercase letters, digits, dashes"),
    name: z.string().trim().min(1).max(120),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .refine((v) => Date.parse(v.startsAt) < Date.parse(v.endsAt), {
    message: "End must be after start",
    path: ["endsAt"],
  });

export async function createHacklantaEdition(input: z.input<typeof createEditionSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = createEditionSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  const ctx = await adminContext();
  if (!ctx) return err("FORBIDDEN", "Admins only.");
  const { data, error } = await ctx.supabase
    .from("hacklanta_editions")
    .insert({
      slug: parsed.data.slug,
      name: parsed.data.name,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
    })
    .select("id")
    .single();
  if (error || !data) return dbErr(error ?? {});
  revalidatePath("/admin/hacklanta");
  return ok({ id: String(data.id) });
}
