// Matches only the single-event detail route (/events/<slug>), not the
// /events list. Shared by middleware.ts, app/login/page.tsx, and
// app/auth/callback/route.ts so "which path is publicly viewable" can't
// drift between them. Per the 2026-08-20 RSVP-first decision: this route is
// viewable with no session, and a not-yet-onboarded user redirected here
// after signing in should still land on it rather than get diverted into
// onboarding first. /events/[slug] has no nested sub-routes today (see the
// app/events tree) — if one is added, this pattern needs to exclude it.
const EVENT_DETAIL_PATTERN = /^\/events\/[^/]+\/?$/;
// Bare /events list only — added alongside the detail route once anonymous
// visitors also got a "Discover Events" entry point off the landing page.
// Anonymous requests here only ever see the Upcoming tab (My Plans/Past need
// an account); enforced in app/events/page.tsx, not here.
const EVENTS_LIST_PATTERN = /^\/events\/?$/;

export function isPublicEventDetailPath(pathname: string): boolean {
  return EVENT_DETAIL_PATTERN.test(pathname);
}

export function isPublicEventsListPath(pathname: string): boolean {
  return EVENTS_LIST_PATTERN.test(pathname);
}
