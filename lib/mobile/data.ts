import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { loadOnboardingState } from "@/lib/auth/onboarding";
import { resolveCoverUrl, resolveCoverUrls } from "@/lib/events/cover-url";
import type * as C from "./contracts";
import { fail, pgError } from "./http";

// Events have no per-row zone; every Progsu event is in Atlanta.
export const EVENT_TIME_ZONE = "America/New_York";

export function ts(v: string): string;
export function ts(v: string | null | undefined): string | null;
export function ts(v: string | null | undefined): string | null {
  return v ? new Date(v).toISOString() : null;
}

type EventRow = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  cover_image_path: string | null;
  capacity: number | null;
  going_count: number | string | null;
  waitlisted_count?: number | string | null;
  waitlist_enabled: boolean;
  external_url?: string | null;
  pinned?: boolean | null;
  description_md?: string | null;
  location_url?: string | null;
  hosts?: unknown;
  status?: string;
};

export async function toEventSummaries(
  supabase: SupabaseClient,
  rows: EventRow[]
): Promise<z.infer<typeof C.eventSummary>[]> {
  const covers = await resolveCoverUrls(
    supabase,
    rows.map((r) => r.cover_image_path)
  );
  return rows.map((r, i) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    startsAt: ts(r.starts_at),
    endsAt: ts(r.ends_at),
    timeZone: EVENT_TIME_ZONE,
    locationText: r.location_text,
    coverImageUrl: covers[i] ?? null,
    capacity: r.capacity,
    goingCount: Number(r.going_count ?? 0),
    waitlistEnabled: r.waitlist_enabled,
    externalUrl: r.external_url ?? null,
    pinned: Boolean(r.pinned),
  }));
}

export async function toEventDetail(
  supabase: SupabaseClient,
  r: EventRow,
  viewer: z.infer<typeof C.eventDetail>["viewer"]
): Promise<z.infer<typeof C.eventDetail>> {
  const hosts = Array.isArray(r.hosts)
    ? (r.hosts as Array<{ display_name?: string; displayName?: string }>).map((h) => ({
        displayName: String(h.display_name ?? h.displayName ?? ""),
      }))
    : [];
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    startsAt: ts(r.starts_at),
    endsAt: ts(r.ends_at),
    timeZone: EVENT_TIME_ZONE,
    locationText: r.location_text,
    coverImageUrl: await resolveCoverUrl(supabase, r.cover_image_path),
    capacity: r.capacity,
    goingCount: Number(r.going_count ?? 0),
    waitlistEnabled: r.waitlist_enabled,
    externalUrl: r.external_url ?? null,
    pinned: Boolean(r.pinned),
    descriptionMd: r.description_md ?? null,
    locationUrl: r.location_url ?? null,
    waitlistedCount: Number(r.waitlisted_count ?? 0),
    hosts,
    status: (r.status as "published" | "cancelled" | "archived") ?? "published",
    viewer,
  };
}

const PROFILE_COLUMNS =
  "id, google_email, first_name, last_name, preferred_name, avatar_url, phone_number, affiliation, institution_name, school, major, major_other_text, student_email, student_email_verified, is_admin";

export async function loadMe(
  supabase: SupabaseClient,
  userId: string
): Promise<z.infer<typeof C.me>> {
  const [profileRes, state, versionsRes, staffRes, balanceRes, gsuRes] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).single(),
    loadOnboardingState(supabase, userId),
    supabase.from("consent_versions").select("consent_type, version"),
    supabase
      .from("event_staff_assignments")
      .select("event_id, expires_at")
      .eq("user_id", userId)
      .is("revoked_at", null),
    supabase.rpc("points_balance", { p_user_id: userId }),
    supabase.rpc("is_verified_gsu", { p_user_id: userId }),
  ]);
  if (profileRes.error || !profileRes.data) {
    if (profileRes.error) throw pgError(profileRes.error);
    fail("not_found", "Profile not found.");
  }
  if (balanceRes.error) throw pgError(balanceRes.error);
  const p = profileRes.data as Record<string, unknown>;
  const now = Date.now();
  return {
    id: String(p.id),
    email: String(p.google_email),
    firstName: (p.first_name as string | null) ?? null,
    lastName: (p.last_name as string | null) ?? null,
    preferredName: (p.preferred_name as string | null) ?? null,
    avatarUrl: (p.avatar_url as string | null) ?? null,
    phoneNumber: (p.phone_number as string | null) ?? null,
    affiliation: (p.affiliation as z.infer<typeof C.affiliation>) ?? "unknown",
    institutionName: (p.institution_name as string | null) ?? null,
    school: (p.school as string | null) ?? null,
    major: (p.major as string | null) ?? null,
    majorOtherText: (p.major_other_text as string | null) ?? null,
    studentEmail: (p.student_email as string | null) ?? null,
    studentEmailVerified: Boolean(p.student_email_verified),
    verifiedGsu: gsuRes.data === true,
    isAdmin: Boolean(p.is_admin),
    onboarding: {
      fullyOnboarded: state.fullyOnboarded,
      nextStep: state.nextStep,
      profileFieldsComplete: state.profileFieldsComplete,
      requiredConsentsCurrent: state.requiredConsentsCurrent,
      studentEmailVerified: state.studentEmailVerified,
      hasCurrentResume: state.hasCurrentResume,
    },
    consentVersions: Object.fromEntries(
      (versionsRes.data ?? []).map((r) => [String(r.consent_type), String(r.version)])
    ),
    staffAssignments: (staffRes.data ?? [])
      .filter((s) => !s.expires_at || Date.parse(s.expires_at as string) > now)
      .map((s) => ({ eventId: String(s.event_id), expiresAt: ts(s.expires_at as string | null) })),
    pointsBalance: Number(balanceRes.data ?? 0),
  };
}
