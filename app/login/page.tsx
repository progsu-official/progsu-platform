import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingPathFor } from "@/lib/auth/onboarding";
import { isPublicEventDetailPath } from "@/lib/events/public-path";

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
    // Admins bypass onboarding entirely (D8), so an explicit `next` should
    // always win for them — same as a fully-onboarded member. Previously
    // this checked isAdmin first and hard-redirected to /admin regardless of
    // `next`, which meant an admin who followed any deep link (e.g. the
    // self-check-in QR) lost that destination and landed on the dashboard
    // instead. Bug found 2026-09-15 testing the QR check-in flow.
    if (
      params.next &&
      params.next.startsWith("/") &&
      (state.isAdmin || state.fullyOnboarded || isPublicEventDetailPath(params.next))
    ) {
      // Public event page: honor `next` even mid-funnel, per the 2026-08-20
      // RSVP-first decision — signing in from there should land back on the
      // event, not get diverted into onboarding.
      redirect(params.next);
    }
    if (state.isAdmin) redirect("/admin");
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
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[48rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,hsl(258_92%_69%/0.18),transparent)]"
      />
      <div className="relative w-full max-w-sm animate-fade-up space-y-8 motion-reduce:animate-none">
        <header className="space-y-3 text-center">
          <p className="text-[15px] font-semibold tracking-tight text-white/60">
            progsu
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white">
            Welcome back
          </h1>
          <p className="text-base text-white/60">
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
          <GoogleSignInButton next={params.next} autoStart={!errorMessage} />

          <p className="text-center text-sm text-white/45">
            You&apos;ll verify your student email in the next step.
          </p>
        </div>
      </div>
    </main>
  );
}
