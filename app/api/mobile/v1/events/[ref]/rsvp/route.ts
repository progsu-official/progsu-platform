import { rsvpAsMember, runRsvpSideEffects } from "@/lib/domain/rsvp";
import { requireUser } from "@/lib/mobile/auth";
import { rsvpBody } from "@/lib/mobile/contracts";
import { fail, json, mobileRoute, pgError, rateLimit, readJson, uuidParam } from "@/lib/mobile/http";
import { requireEventsOn } from "@/lib/mobile/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /events/{id}/rsvp. rsvp_to_event is idempotent per (event, user).
export const POST = mobileRoute("events.rsvp", async ({ req, requestId, params }) => {
  requireEventsOn();
  const eventId = uuidParam(params.ref);
  const auth = await requireUser(req);
  await rateLimit("rsvp", auth.user.id, 60, 3600);
  const body = await readJson(req, rsvpBody);
  const result = await rsvpAsMember(auth.supabase, auth.user.id, {
    eventId,
    desired: body.desired,
    comment: body.comment ?? null,
  });
  if (!result.ok) {
    if (result.error.code) throw pgError(result.error);
    fail("internal", "Something went wrong.");
  }
  runRsvpSideEffects({
    eventId,
    userId: auth.user.id,
    previous: result.previous,
    status: result.status,
    sendRsvpEmail: result.sendRsvpEmail,
    campaignSlug: null,
  });
  return json({ effectiveStatus: result.status }, requestId);
});
