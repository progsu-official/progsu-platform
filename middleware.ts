import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import {
  isPublicEventDetailPath,
  isPublicEventsListPath,
} from "@/lib/events/public-path";

// Route classification. Keep these in sync with the canonical route map in
// docs/07-implementation-plan.md §1.1. Admins bypass member onboarding (D8).
// /tickets/[token] is public by design (2026-08-21 guest-ticket decision): the
// opaque per-registration token in the path IS the credential, and the holder
// is an account-free guest opening an email link at a door. Bouncing them to
// Google sign-in would make the ticket unusable by exactly the people it was
// built for. Access control lives in guest_ticket_by_token(), which only ever
// returns the row matching the token presented.
//
// /joined/[token] is public on the same reasoning (docs/16-guest-conversion
// §3.2): it is the page a guest lands on immediately after registering, before
// they have any account at all. Its claim token is the credential and
// guest_claim_context() only ever returns the row matching it. Bouncing this
// one to /login would defeat the entire point — the page exists to talk
// someone into signing up.
const PUBLIC_PREFIXES = [
  "/",
  "/home",
  "/login",
  "/privacy",
  "/terms",
  "/auth/callback",
  "/tickets",
  "/joined",
];
const ADMIN_PREFIXES = ["/admin"];
const ONBOARDING_PREFIX = "/onboarding";
const MEMBER_PREFIXES = ["/profile", "/events", "/members"];

// Exported for reuse by lib/actions/session.ts: logout needs the same
// "does this path have a signed-out view" classification so it can land the
// user back where they were instead of always bouncing to /login.
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some(
    (p) => p !== "/" && (pathname === p || pathname.startsWith(p + "/"))
  );
}

function isAdminPath(pathname: string): boolean {
  return ADMIN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function isOnboardingPath(pathname: string): boolean {
  return pathname === ONBOARDING_PREFIX || pathname.startsWith(ONBOARDING_PREFIX + "/");
}

function isMemberPath(pathname: string): boolean {
  return MEMBER_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Public paths: always pass through (session cookies still refreshed above).
  if (isPublicPath(pathname)) {
    return supabaseResponse;
  }

  // Single event pages, and the bare /events list (Upcoming tab only for an
  // anonymous visitor — enforced in app/events/page.tsx), are public
  // regardless of session.
  if (isPublicEventDetailPath(pathname) || isPublicEventsListPath(pathname)) {
    return supabaseResponse;
  }

  // Unauthenticated access to anything non-public → bounce to /login. Local
  // dev convenience: DEV_AUTO_LOGIN=true bounces to the dev-login bypass
  // instead, so there's never a manual sign-in step at all on this machine.
  // Hard-gated on NODE_ENV, same as /api/dev-login itself.
  if (!user) {
    const url = request.nextUrl.clone();
    if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTO_LOGIN === "true") {
      url.pathname = "/api/dev-login";
      url.searchParams.set("role", "member");
      url.searchParams.set("next", pathname);
    } else {
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  // Admin paths (/admin/*) are checked in the layout, not middleware — the admin layout
  // renders notFound() for non-admins so the admin surface doesn't leak through 403/redirects.
  if (isAdminPath(pathname)) {
    return supabaseResponse;
  }

  // Onboarding + member paths: the layout (or page) runs the onboarding cascade and
  // decides whether to redirect. Middleware's job is just to ensure a session exists.
  if (isOnboardingPath(pathname) || isMemberPath(pathname)) {
    return supabaseResponse;
  }

  return supabaseResponse;
}

export const config = {
  // Skip Next.js internals + static files + webhook endpoints (which verify their own HMAC)
  // + cron endpoints (which verify CRON_SECRET themselves) + smoketest routes
  // (only created during integration smoke scripts; they self-auth) + dev-login
  // (local-only Google OAuth bypass; self-gates on NODE_ENV).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks/|api/cron/|api/smoketest-|api/dev-login|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
