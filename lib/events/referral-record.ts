import "server-only";

import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import {
  REFERRAL_COOKIE,
  REFERRAL_TTL_SECONDS,
  parseReferralCookie,
  serializeReferralCookie,
  withCounted,
  type ReferralFlag,
} from "./referral";

// Counts a conversion against whatever campaign link brought this browser
// here, if any. Called from the RSVP actions and /auth/callback.
//
// Two things this deliberately does NOT do:
//
//   1. It never passes the user's identity to the database. The RPC takes a
//      slug and a kind, and referral_link_hits has nowhere to put a person.
//   2. It never throws. Attribution is bookkeeping that runs alongside the
//      thing the user actually asked for, and an RSVP must not fail because a
//      stat did not get written.
//
// Dedupe is a flag written back into the cookie, so each browser counts at
// most one RSVP and one signup per link. That is the honest ceiling for what
// a cookie can know: it cannot tell that the same person RSVP'd from their
// phone as well, and it will not try.

export async function recordReferralConversion(kind: ReferralFlag): Promise<void> {
  if (!env.FEATURE_REFERRAL_LINKS) return;

  try {
    const store = await cookies();
    const cookie = parseReferralCookie(store.get(REFERRAL_COOKIE)?.value);
    if (!cookie) return;
    if (cookie.counted.includes(kind)) return;

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_referral_conversion", {
      p_slug: cookie.slug,
      p_kind: kind,
    });
    if (error) {
      console.error("[referral] conversion record failed:", error.message);
      return;
    }
    // false means the slug no longer resolves — the link was deleted. Leave
    // the cookie unflagged; there is nothing to double-count against.
    if (data !== true) return;

    store.set(REFERRAL_COOKIE, serializeReferralCookie(withCounted(cookie, kind)), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: REFERRAL_TTL_SECONDS,
    });
  } catch (e) {
    console.error("[referral] conversion record threw:", e);
  }
}

/**
 * The campaign slug this browser is currently attributed to, or null.
 *
 * Read-only sibling of recordReferralConversion above: the Discord alert wants
 * to name the campaign, and that is a display concern rather than a counting
 * one, so it must not touch the dedupe flags. Same swallow-everything posture
 * — a slug we cannot read is simply no campaign.
 */
export async function readReferralSlug(): Promise<string | null> {
  if (!env.FEATURE_REFERRAL_LINKS) return null;
  try {
    const store = await cookies();
    return parseReferralCookie(store.get(REFERRAL_COOKIE)?.value)?.slug ?? null;
  } catch {
    return null;
  }
}
