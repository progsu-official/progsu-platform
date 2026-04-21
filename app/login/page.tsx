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
    const next = onboardingPathFor(state.nextStep) ?? "/dashboard";
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
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Progsu</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to continue to the member platform.
          </p>
        </header>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {errorMessage}
          </div>
        ) : null}

        <GoogleSignInButton next={params.next} />

        <p className="text-center text-xs text-muted-foreground">
          You&apos;ll verify your student email in the next step.
        </p>
      </div>
    </main>
  );
}
