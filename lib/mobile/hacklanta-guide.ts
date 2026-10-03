import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type * as C from "./contracts";
import { ts } from "./data";
import { pgError } from "./http";

// Public Hacklanta guide. Reads with the anon client: RLS only returns
// published editions and their children.

export const HACKLANTA_FLOORS_BUCKET = "hacklanta-floors";

export type EditionRow = {
  id: string;
  slug: string;
  name: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  venue_name: string | null;
  venue_address: string | null;
  lat: number | null;
  lng: number | null;
  theme: Record<string, unknown> | null;
  theme_override: "auto" | "force_on" | "force_off";
  schedule_tentative: boolean;
  published_at: string;
};

// Theme 'auto' runs from 7 days before the start until the end.
export function themeActive(e: EditionRow, now = Date.now()): boolean {
  if (e.theme_override === "force_on") return true;
  if (e.theme_override === "force_off") return false;
  return now >= Date.parse(e.starts_at) - 7 * 86_400_000 && now <= Date.parse(e.ends_at);
}

export async function loadActiveEdition(supabase: SupabaseClient): Promise<EditionRow | null> {
  // The edition nearest in the future (or running); else the latest one.
  const { data, error } = await supabase
    .from("hacklanta_editions")
    .select("*")
    .order("ends_at", { ascending: false })
    .limit(5);
  if (error) throw pgError(error);
  const rows = (data ?? []) as EditionRow[];
  const now = Date.now();
  const upcoming = rows
    .filter((r) => Date.parse(r.ends_at) >= now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return upcoming[0] ?? rows[0] ?? null;
}

export function editionSummary(e: EditionRow): z.infer<typeof C.hacklantaSummary> {
  return {
    slug: e.slug,
    name: e.name,
    startsAt: ts(e.starts_at),
    endsAt: ts(e.ends_at),
    timeZone: e.time_zone,
    themeOverride: e.theme_override,
    themeActive: themeActive(e),
    theme: e.theme ?? {},
    scheduleTentative: e.schedule_tentative,
  };
}

export async function loadGuide(
  supabase: SupabaseClient,
  e: EditionRow
): Promise<z.infer<typeof C.hacklantaGuide>> {
  const [floors, rooms, sessions] = await Promise.all([
    supabase.from("hacklanta_floors").select("*").eq("edition_id", e.id).order("sort"),
    supabase.from("hacklanta_rooms").select("*").eq("edition_id", e.id).order("name"),
    supabase.from("hacklanta_sessions").select("*").eq("edition_id", e.id).order("starts_at").order("key"),
  ]);
  for (const r of [floors, rooms, sessions]) if (r.error) throw pgError(r.error);

  return {
    edition: {
      ...editionSummary(e),
      venueName: e.venue_name,
      venueAddress: e.venue_address,
      lat: e.lat,
      lng: e.lng,
      publishedAt: ts(e.published_at),
    },
    floors: (floors.data ?? []).map((f) => ({
      id: String(f.id),
      name: String(f.name),
      sort: Number(f.sort),
      imageUrl: f.image_path
        ? `${supabase.storage.from(HACKLANTA_FLOORS_BUCKET).getPublicUrl(String(f.image_path)).data.publicUrl}?v=${f.version}`
        : null,
      version: Number(f.version),
    })),
    rooms: (rooms.data ?? []).map((r) => ({
      id: String(r.id),
      floorId: (r.floor_id as string | null) ?? null,
      name: String(r.name),
      kind: String(r.kind),
      description: (r.description as string | null) ?? null,
      x: (r.x as number | null) ?? null,
      y: (r.y as number | null) ?? null,
    })),
    sessions: (sessions.data ?? []).map((s) => ({
      id: String(s.id),
      key: String(s.key),
      title: String(s.title),
      description: (s.description as string | null) ?? null,
      kind: String(s.kind),
      track: (s.track as string | null) ?? null,
      roomId: (s.room_id as string | null) ?? null,
      roomLabel: (s.room_label as string | null) ?? null,
      startsAt: ts(s.starts_at as string),
      endsAt: ts(s.ends_at as string | null),
      status: s.status as "scheduled" | "cancelled" | "moved",
      pointsNote: (s.points_note as string | null) ?? null,
      updatedAt: ts(s.updated_at as string),
    })),
  };
}
