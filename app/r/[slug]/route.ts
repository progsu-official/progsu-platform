import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import {
  REFERRAL_COOKIE,
  REFERRAL_TTL_SECONDS,
  parseReferralCookie,
  serializeReferralCookie,
} from "@/lib/events/referral";

// Campaign short links: /r/<slug> -> the event page, counting the click.
//
// This is the one surface a total stranger reaches first — it is what's
// printed on the flyer — so every failure mode lands somewhere useful instead
// of on an error. Unknown slug, archived link, unpublished event, feature
// flag off: all of them redirect to /events. A dead link in the wild is our
// problem, not the visitor's.
//
// Recording runs on the admin client because record_referral_click is granted
// to service_role only. That is the whole anti-abuse story: the RPC is not
// reachable from a browser, so nobody can replay it to inflate a campaign.

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const origin = env.NEXT_PUBLIC_SITE_URL;
  const fallback = NextResponse.redirect(new URL("/events", origin));

  if (!env.FEATURE_REFERRAL_LINKS || !env.FEATURE_EVENTS) return fallback;

  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(normalized)) return fallback;

  // A repeat visit from the same browser still redirects and is still
  // recorded, but only the first counts as a visitor — otherwise a poster in
  // a hallway someone walks past twice a day reads as a runaway success.
  const prior = parseReferralCookie(request.cookies.get(REFERRAL_COOKIE)?.value);
  const isNewVisitor = prior?.slug !== normalized;

  let eventSlug: string | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_referral_click", {
      p_slug: normalized,
      p_is_new_visitor: isNewVisitor,
    });
    if (error) {
      console.error("[referral] click record failed:", error.message);
    } else {
      const row = Array.isArray(data) ? data[0] : null;
      eventSlug = (row?.event_slug as string | undefined) ?? null;
    }
  } catch (e) {
    // Attribution is bookkeeping. If it breaks, the visitor still gets to the
    // event — losing a stat is survivable, losing the click is not.
    console.error("[referral] click record threw:", e);
  }

  if (!eventSlug) return fallback;

  const response = NextResponse.redirect(new URL(`/events/${eventSlug}`, origin));
  response.cookies.set(
    REFERRAL_COOKIE,
    // Re-issued on every visit so the TTL slides, and reset to "nothing
    // counted yet" whenever the slug changes.
    serializeReferralCookie(
      isNewVisitor ? { slug: normalized, counted: [] } : prior!
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: REFERRAL_TTL_SECONDS,
    }
  );
  return response;
}
