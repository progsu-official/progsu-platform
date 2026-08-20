import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";

import { GoogleSignInButton } from "./google-sign-in-button";

type SearchParams = {
  next?: string;
  error?: string;
  error_description?: string;
};

const ERROR_COPY: Record<string, string> = {
  missing_code: "Sign-in didn't complete. Please try again.",
  exchange_failed: "We couldn't verify that sign-in. Please try again.",
  session_missing: "Your session didn't save. Check that cookies are enabled.",
  server_error: "Something went wrong on our end. Please try again.",
  access_denied: "You cancelled the Google sign-in.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // If already signed in, route past /login using the same cascade as /auth/callback.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const state = await loadOnboardingState(supabase, user.id);
    if (state.isAdmin) redirect("/admin");
    if (state.fullyOnboarded && params.next && params.next.startsWith("/")) {
      redirect(params.next);
    }
    const next = onboardingPathFor(state.nextStep) ?? "/profile";
    redirect(next);
  }

  const errorKey = params.error;
  const errorMessage =
    errorKey && ERROR_COPY[errorKey]
      ? ERROR_COPY[errorKey]
      : params.error_description || errorKey
        ? "Sign-in failed. Please try again."
        : null;

  return (
    <main className="dark relative flex min-h-screen items-center justify-center overflow-hidden bg-[#151515] px-4 py-12 text-foreground">
      <div className="relative w-full max-w-sm animate-fade-up space-y-8">
        <header className="space-y-3 text-center">
          <p className="text-[15px] font-semibold tracking-tight text-white/40">
            progsu
          </p>
          <h1 className="text-4xl font-medium tracking-[-0.01em] text-white">
            Welcome back
          </h1>
          <p className="text-base text-white/50">
            Sign in to continue to the member platform.
          </p>
        </header>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="space-y-5">
          <GoogleSignInButton next={params.next} />

          <p className="text-center text-sm text-white/40">
            You&apos;ll verify your student email in the next step.
          </p>
        </div>
      </div>
    </main>
  );
}
