import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEventRsvpConfirmation } from "@/lib/email/events";
import { notifyRsvpInBackground } from "@/lib/discord/notify-rsvp";
import type { RsvpAlertKind } from "@/lib/discord/rsvp-alert";

export type EffectiveRsvpStatus = "going" | "waitlisted" | "declined" | "cancelled";

// Which RSVP transitions are worth announcing in Discord, and as what.
//
// Edges, not states: re-saving 'going' is not news, and a member who declines
// an event they were never going to is not either. The three that are news
// are someone joining, someone landing on the waitlist, and a seat opening
// back up — that last one is the cue for whoever is watching the waitlist.
export function rsvpAlertKindFor(
  previous: EffectiveRsvpStatus | null,
  next: EffectiveRsvpStatus
): RsvpAlertKind | null {
  if (next === previous) return null;
  if (next === "going") return "going";
  if (next === "waitlisted") return "waitlisted";
  if (previous === "going") return "cancelled";
  return null;
}

// Shared by the web rsvpToEvent action and POST /api/mobile/v1/events/{id}/rsvp.
// `supabase` acts as the member (cookie session or bearer); rsvp_to_event
// enforces every rule.
export async function rsvpAsMember(
  supabase: SupabaseClient,
  userId: string,
  input: { eventId: string; desired: string; comment?: string | null }
): Promise<
  | { ok: true; previous: EffectiveRsvpStatus | null; status: EffectiveRsvpStatus; sendRsvpEmail: boolean }
  | { ok: false; error: { code?: string; message?: string } }
> {
  const [{ data: priorRsvp }, { data: eventRow }] = await Promise.all([
    supabase
      .from("event_rsvps")
      .select("status")
      .eq("event_id", input.eventId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("events").select("send_rsvp_email").eq("id", input.eventId).maybeSingle(),
  ]);

  const { data, error } = await supabase.rpc("rsvp_to_event", {
    p_event_id: input.eventId,
    p_desired: input.desired,
    p_comment: input.comment ?? null,
  });
  if (error) return { ok: false, error };
  if (typeof data !== "string") {
    return { ok: false, error: { message: "RSVP saved but effective status missing." } };
  }
  return {
    ok: true,
    previous: (priorRsvp?.status as EffectiveRsvpStatus | undefined) ?? null,
    status: data as EffectiveRsvpStatus,
    sendRsvpEmail: eventRow?.send_rsvp_email === true,
  };
}

// Confirmation email + Discord alert. Fire-and-forget, like the web path.
export function runRsvpSideEffects(input: {
  eventId: string;
  userId: string;
  previous: EffectiveRsvpStatus | null;
  status: EffectiveRsvpStatus;
  sendRsvpEmail: boolean;
  campaignSlug: string | null;
}) {
  if (input.status === "going" && input.previous !== "going" && input.sendRsvpEmail) {
    void sendEventRsvpConfirmation({ eventId: input.eventId, userId: input.userId }).catch((e) => {
      console.error("[events] rsvp confirmation send failed:", e);
    });
  }
  const alertKind = rsvpAlertKindFor(input.previous, input.status);
  if (alertKind) {
    notifyRsvpInBackground({
      eventId: input.eventId,
      kind: alertKind,
      userId: input.userId,
      campaignSlug: input.campaignSlug,
    });
  }
}
