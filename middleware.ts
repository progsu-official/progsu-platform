import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// Route classification. Keep these in sync with the canonical route map in
// docs/07-implementation-plan.md §1.1. Admins bypass member onboarding (D8).
const PUBLIC_PREFIXES = ["/", "/login", "/privacy", "/terms", "/auth/callback"];
const ADMIN_PREFIXES = ["/admin"];
const ONBOARDING_PREFIX = "/onboarding";
const MEMBER_PREFIXES = ["/dashboard", "/events", "/members"];

function isPublicPath(pathname: string): boolean {
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

  // Unauthenticated access to anything non-public → bounce to /login.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
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
  // + smoketest routes (only created during integration smoke scripts; they self-auth).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks/|api/smoketest-|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
