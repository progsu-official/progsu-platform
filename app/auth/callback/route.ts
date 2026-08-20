import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

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

  // Admins always go to the admin surface; they bypass member onboarding (D8).
  const state = await loadOnboardingState(supabase, user.id);

  let targetPath: string;
  if (state.isAdmin) {
    targetPath = "/admin";
  } else if (
    state.fullyOnboarded &&
    requestedNext &&
    requestedNext.startsWith("/")
  ) {
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
  return response;
}
