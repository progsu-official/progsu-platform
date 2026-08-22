"use client";

import { usePathname } from "next/navigation";

import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";

// Skips the /login interstitial — clicking "Sign in" drops straight into
// Google's OAuth screen, carrying the current path as `next` so the user
// lands back where they clicked from.
export function HeaderSignInButton() {
  const pathname = usePathname();
  const { pending, signIn } = useGoogleSignIn(pathname);

  return (
    <button
      type="button"
      onClick={() => signIn()}
      disabled={pending}
      className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50 disabled:opacity-60"
    >
      {pending ? "Redirecting…" : "Sign in"}
    </button>
  );
}
