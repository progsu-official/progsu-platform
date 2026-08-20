"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { type ActionResult, err, ok } from "./result";
import {
  listMemberCardsSchema,
  setProfileSlugSchema,
  setProfileVisibilitySchema,
  type SetProfileSlugInput,
  type SetProfileVisibilityInput,
} from "./member-schemas";

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------
// R2 helpers raise a small set of predictable messages. We branch on those so
// the UI can surface structured errors (e.g., the re-acceptance route) rather
// than generic strings.

function mapPgError(error: { code?: string | null; message?: string } | null) {
  if (!error) return err("INTERNAL", "Unknown database error.");
  const code = error.code ?? "";
  const msg = error.message ?? "Database error.";

  if (code === "P0002") return err("NOT_FOUND", msg);

  if (code === "P0001") {
    const lower = msg.toLowerCase();
    if (lower.includes("reaccept_privacy")) {
      return err(
        "FORBIDDEN",
        "Accept the updated privacy policy before making your profile visible.",
        { field: "privacy_policy" }
      );
    }
    if (
      lower.includes("unauthenticated") ||
      lower.includes("not fully onboarded")
    ) {
      return err("FORBIDDEN", msg);
    }
    if (lower.includes("slug is taken")) {
      return err("CONFLICT", "That URL is taken. Choose another.", {
        field: "slug",
      });
    }
    if (lower.includes("could not find an available slug")) {
      return err(
        "CONFLICT",
        "Could not find an available URL for that name. Try something else.",
        { field: "slug" }
      );
    }
    return err("INVALID_INPUT", msg);
  }

  return err("INTERNAL", msg);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function setProfileVisibility(
  rawInput: SetProfileVisibilityInput
): Promise<ActionResult<{ updated: true }>> {
  const parsed = setProfileVisibilitySchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid input"
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  const { error } = await supabase.rpc("set_profile_visibility", {
    p_payload: parsed.data,
  });
  if (error) return mapPgError(error);

  revalidatePath("/profile/settings");
  revalidatePath("/members");
  return ok({ updated: true });
}

export async function setProfileSlug(
  rawInput: SetProfileSlugInput
): Promise<ActionResult<{ slug: string }>> {
  const parsed = setProfileSlugSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err("INVALID_INPUT", first?.message ?? "Invalid slug.", {
      field: "slug",
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  const { data, error } = await supabase.rpc("set_profile_slug", {
    p_desired_slug: parsed.data.slug,
  });
  if (error) return mapPgError(error);

  const slug = typeof data === "string" ? data : null;
  if (!slug) return err("INTERNAL", "Slug set but response missing.");

  revalidatePath("/profile/settings");
  revalidatePath("/members");
  return ok({ slug });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type MemberCardRow = {
  user_id: string;
  profile_slug: string | null;
  display_name: string | null;
  avatar_url: string | null;
  school: string | null;
  class_standing: string | null;
  grad_term: string | null;
  grad_year: number | null;
  interested_roles: string[] | null;
  discord_username: string | null;
  discord_user_id: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  bio: string | null;
  note: string | null;
  banner_url: string | null;
  share_attended_events: boolean;
  visible_since: string | null;
};

export type MemberCardAttendedEventRow = {
  event_id: string;
  event_slug: string;
  event_title: string;
  starts_at: string;
  ends_at: string;
  cover_image_path: string | null;
  checked_in_at: string | null;
};

export type SharedEventNamed = {
  event_id: string;
  event_slug: string;
  event_title: string;
  starts_at: string;
};

export type SharedEventsResult = {
  aggregate_count: number;
  named_events: SharedEventNamed[];
};

export async function listMemberCards(
  input: z.input<typeof listMemberCardsSchema> = {}
): Promise<ActionResult<MemberCardRow[]>> {
  if (!env.FEATURE_MEMBER_DIRECTORY) {
    // Flag off: feature layer returns empty. Helpers still work if the DB
    // layer is reachable — the env flag is a route kill switch, not a DB one.
    return ok([]);
  }

  const parsed = listMemberCardsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid input"
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  const { data, error } = await supabase.rpc("list_member_cards", {
    p_viewer_id: user.id,
    p_cursor_ts: parsed.data.cursor_ts ?? null,
    p_cursor_user: parsed.data.cursor_user ?? null,
    p_limit: parsed.data.limit ?? 24,
    p_search: parsed.data.search ?? null,
  });
  if (error) return mapPgError(error);
  return ok((data ?? []) as MemberCardRow[]);
}

export async function getMemberCardBySlug(
  slug: string
): Promise<
  ActionResult<{
    card: MemberCardRow;
    attendedEvents: MemberCardAttendedEventRow[];
  } | null>
> {
  if (!env.FEATURE_MEMBER_DIRECTORY) return ok(null);

  const slugParsed = z.string().trim().min(1).max(64).safeParse(slug);
  if (!slugParsed.success) return ok(null);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  const { data: cardRows, error: cardErr } = await supabase.rpc(
    "member_card_for_viewer",
    {
      p_viewer_id: user.id,
      p_target_slug: slugParsed.data,
    }
  );
  if (cardErr) return mapPgError(cardErr);

  const cards = (cardRows ?? []) as MemberCardRow[];
  if (cards.length === 0) return ok(null);
  const card = cards[0];

  let attendedEvents: MemberCardAttendedEventRow[] = [];
  if (card.share_attended_events) {
    const { data: events, error: eventsErr } = await supabase.rpc(
      "member_card_attended_events_for_viewer",
      {
        p_viewer_id: user.id,
        p_target_id: card.user_id,
      }
    );
    if (eventsErr) return mapPgError(eventsErr);
    attendedEvents = (events ?? []) as MemberCardAttendedEventRow[];
  }

  return ok({ card, attendedEvents });
}

// R3: shared events with a target member. Both the viewer and target must
// have share_shared_event_counts=true AND the FEATURE_SHARED_EVENT_HISTORY
// flag must be on at the server-action layer. Flag off OR any gate failure
// returns an empty result (aggregate=0, named=[]) — indistinguishable from
// "no shared events" so the feature's existence doesn't leak.
export async function getSharedEventsForViewer(
  targetUserId: string
): Promise<ActionResult<SharedEventsResult>> {
  const empty: SharedEventsResult = { aggregate_count: 0, named_events: [] };

  if (!env.FEATURE_SHARED_EVENT_HISTORY) return ok(empty);

  const idParsed = z.string().uuid().safeParse(targetUserId);
  if (!idParsed.success) return ok(empty);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  const { data, error } = await supabase.rpc("shared_events_for_viewer", {
    p_viewer_id: user.id,
    p_target_id: targetUserId,
  });
  if (error) return mapPgError(error);

  const row = (data ?? [])[0] as
    | { event_count: number; named_events: SharedEventNamed[] }
    | undefined;
  if (!row) return ok(empty);

  return ok({
    aggregate_count: row.event_count,
    named_events: Array.isArray(row.named_events) ? row.named_events : [],
  });
}

export async function getOwnVisibilitySettings(): Promise<
  ActionResult<{
    discoverable: boolean;
    share_attended_events: boolean;
    share_shared_event_counts: boolean;
    profile_slug: string | null;
    last_discoverability_change_at: string | null;
  } | null>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("UNAUTHORIZED", "Sign in required.");

  const { data, error } = await supabase
    .from("profile_visibility_settings")
    .select(
      "discoverable, share_attended_events, share_shared_event_counts, profile_slug, last_discoverability_change_at"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return err("INTERNAL", error.message);

  return ok(
    data
      ? {
          discoverable: !!data.discoverable,
          share_attended_events: !!data.share_attended_events,
          share_shared_event_counts: !!data.share_shared_event_counts,
          profile_slug: (data.profile_slug as string | null) ?? null,
          last_discoverability_change_at:
            (data.last_discoverability_change_at as string | null) ?? null,
        }
      : null
  );
}
