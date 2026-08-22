"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/browser";

// Shared by every "sign in with Google" entry point that wants to skip the
// /login interstitial and drop straight into Google's OAuth screen.
// /auth/callback already honors `next` for fully-onboarded members and
// public event paths mid-funnel.
export function useGoogleSignIn(defaultNext?: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // nextOverride lets one hook instance serve multiple targets (e.g. a nav
  // list where each item has its own destination) instead of needing a
  // separate hook call per item.
  async function signIn(nextOverride?: string) {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const next = nextOverride ?? defaultNext;

    const redirectTo = new URL("/auth/callback", window.location.origin);
    if (next && next.startsWith("/")) {
      redirectTo.searchParams.set("next", next);
    }

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectTo.toString(),
        queryParams: { access_type: "offline", prompt: "select_account" },
      },
    });

    if (authError) {
      setPending(false);
      setError(authError.message);
    }
    // On success Supabase redirects the browser; no further work here.
  }

  return { pending, error, signIn };
}
