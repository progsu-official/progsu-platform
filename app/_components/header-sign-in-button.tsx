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
      className="inline-flex h-9 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-[opacity,transform] duration-200 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      {pending ? "Redirecting…" : "Sign in"}
    </button>
  );
}
