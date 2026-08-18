"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/browser";

export function GoogleSignInButton({ next }: { next?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    const supabase = createClient();

    // Build the callback URL. Keep `next` as a query param so the callback can honor it
    // after a successful OAuth exchange.
    const redirectTo = new URL(
      "/auth/callback",
      window.location.origin
    );
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
      return;
    }
    // On success Supabase redirects the browser; no further work here.
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        onClick={onClick}
        disabled={pending}
        size="lg"
        className="h-[46px] w-full rounded-full bg-white text-base font-medium text-[#151515] shadow-[0_3px_3px_rgba(0,0,0,0.1),0_8px_7px_rgba(0,0,0,0.13)] hover:bg-white/90 active:scale-[0.99]"
      >
        <GoogleMark className="mr-2 h-4 w-4" />
        {pending ? "Redirecting to Google…" : "Continue with Google"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M12 11v3.07h5.16c-.22 1.33-1.66 3.9-5.16 3.9-3.11 0-5.64-2.57-5.64-5.74s2.53-5.74 5.64-5.74c1.77 0 2.96.75 3.64 1.4l2.48-2.4C16.66 3.93 14.55 3 12 3 6.98 3 2.93 7.03 2.93 12S6.98 21 12 21c6.93 0 9.07-4.83 9.07-8.82 0-.59-.06-1.04-.14-1.18H12z"
      />
    </svg>
  );
}
