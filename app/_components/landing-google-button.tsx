"use client";

import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";

// Skips the /login interstitial — clicking drops straight into Google's
// OAuth screen instead of routing through /login first.
export function LandingGoogleButton() {
  const { pending, signIn } = useGoogleSignIn();

  return (
    <button
      type="button"
      onClick={() => signIn()}
      disabled={pending}
      className="mt-8 inline-flex h-[46px] items-center gap-2.5 rounded-full bg-white px-7 text-lg font-medium text-[#151515] shadow-[0_3px_3px_rgba(0,0,0,0.1),0_8px_7px_rgba(0,0,0,0.13),0_16px_14px_rgba(0,0,0,0.1)] transition-[transform,background-color] duration-150 hover:bg-white/90 active:scale-[0.98] disabled:opacity-70"
    >
      <GoogleLogo className="h-5 w-5" />
      {pending ? "redirecting…" : "continue with google"}
    </button>
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}
