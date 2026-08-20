import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import { loadOnboardingState, type OnboardingState } from "./onboarding";

// Per-request memoisation of the auth work every member surface repeats.
//
// A single navigation to /events runs the layout and the page, and both
// independently called supabase.auth.getUser() and loadOnboardingState() —
// the latter being four queries. So the cheapest possible page view cost two
// auth round-trips and eight profile/consent queries before any of the page's
// own data was fetched.
//
// React's cache() dedupes within one server render pass, so the second caller
// gets the first one's result. It does NOT cache across requests: this is
// deduplication, not a stale-data risk. Note the wrappers take a userId
// rather than a Supabase client — cache() keys on argument identity, and a
// freshly-constructed client is a new object every call, which would miss
// every time.

export const getRequestUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getRequestOnboardingState = cache(
  async (userId: string): Promise<OnboardingState> => {
    const supabase = await createClient();
    return loadOnboardingState(supabase, userId);
  }
);
