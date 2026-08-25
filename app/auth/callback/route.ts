import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";
import { isPublicEventDetailPath } from "@/lib/events/public-path";
import { GUEST_CLAIM_COOKIE } from "@/lib/events/guest-claim";
import { recordReferralConversion } from "@/lib/events/referral-record";

// OAuth callback for Supabase Auth. The user returns here from Google with a `code`
// query param; we exchange it for a session, then route them to their next step.
//
// Success paths:
//   - admin → /admin
//   - member with next onboarding step → /onboarding/<step>
//   - member fully onboarded → /profile
//
// Failure paths:
//   - anything else → /login?error=<reason>
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");
  const errorParam = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const origin = env.NEXT_PUBLIC_SITE_URL;

  if (errorParam) {
    const redirect = new URL("/login", origin);
    redirect.searchParams.set("error", errorParam);
    if (errorDescription) {
      redirect.searchParams.set("error_description", errorDescription);
    }
    return NextResponse.redirect(redirect);
  }

  if (!code) {
    const redirect = new URL("/login", origin);
    redirect.searchParams.set("error", "missing_code");
    return NextResponse.redirect(redirect);
  }

  const supabase = await createClient();
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    const redirect = new URL("/login", origin);
    redirect.searchParams.set("error", "exchange_failed");
    return NextResponse.redirect(redirect);
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    const redirect = new URL("/login", origin);
    redirect.searchParams.set("error", "session_missing");
    return NextResponse.redirect(redirect);
  }

  // A guest who just registered and then came here to make an account carries
  // their claim token in a short-lived cookie. Link it before we read
  // onboarding state, so the copied name/phone/school email count toward the
  // routing decision below and they are not asked for what we already have.
  //
  // Deliberately not fatal: a failed or replayed claim must never cost someone
  // the account they just created. claim_guest_identity() is idempotent and
  // returns false rather than raising for an unknown or already-linked token.
  const claimToken = request.cookies.get(GUEST_CLAIM_COOKIE)?.value;
  if (claimToken) {
    const { error: claimErr } = await supabase.rpc("claim_guest_identity", {
      p_token: claimToken,
    });
    if (claimErr) {
      console.error("[auth] guest identity claim failed:", claimErr.message);
    }
  }

  // Campaign attribution for a signup. Supabase stamps created_at when the
  // account is first provisioned, so a fresh timestamp is what separates
  // "signed up just now" from "signed in again" — every later callback for
  // this user falls outside the window and records nothing. The cookie write
  // this performs is picked up by the store.getAll() loop below.
  const signedUpJustNow =
    Date.now() - new Date(user.created_at).getTime() < 5 * 60 * 1000;
  if (signedUpJustNow) await recordReferralConversion("signup");

  // Admins always go to the admin surface; they bypass member onboarding (D8).
  const state = await loadOnboardingState(supabase, user.id);

  let targetPath: string;
  if (state.isAdmin) {
    targetPath = "/admin";
  } else if (
    requestedNext &&
    requestedNext.startsWith("/") &&
    (state.fullyOnboarded || isPublicEventDetailPath(requestedNext))
  ) {
    // Public event page: honor `next` even mid-funnel, per the 2026-08-20
    // RSVP-first decision — landing back on the event is the point; the
    // onboarding nudge happens after a successful RSVP, not before.
    targetPath = requestedNext;
  } else if (
    !state.studentEmailVerified &&
    !state.profileFieldsComplete
  ) {
    // First-time signup: invite verification upfront so the OTP email is fresh
    // in their inbox. They can still skip; verify-email itself offers a "verify
    // later" escape that drops them into /onboarding/profile.
    targetPath = "/onboarding/verify-email";
  } else {
    targetPath = onboardingPathFor(state.nextStep) ?? "/profile";
  }

  // Explicitly forward every cookie written into the Next cookie store during
  // exchangeCodeForSession onto the redirect response. Without this step the
  // browser follows the redirect with no sb-*-auth-token cookie, middleware
  // sees no session, and we loop back to /login.
  const response = NextResponse.redirect(new URL(targetPath, origin));
  const store = await cookies();
  for (const c of store.getAll()) {
    response.cookies.set(c.name, c.value);
  }
  if (claimToken) response.cookies.delete(GUEST_CLAIM_COOKIE);
  return response;
}
