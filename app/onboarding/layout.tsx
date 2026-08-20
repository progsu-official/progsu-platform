import { redirect } from "next/navigation";
import Link from "next/link";
import { Instrument_Serif } from "next/font/google";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState } from "@/lib/auth/onboarding";
import { StepIndicator } from "./_components/step-indicator";

export const dynamic = "force-dynamic";

// The display voice, loaded on this route only. tailwind.config maps
// font-serif to --font-display with a Georgia fallback, so a route that uses
// font-serif has to load the face itself.
const display = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

type Props = {
  children: React.ReactNode;
};

export default async function OnboardingLayout({ children }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Admins are never FORCED through this funnel (the member layouts skip the
  // cascade for them, D8) but they must be able to walk it voluntarily — the
  // DB-side is_fully_onboarded() gate still applies to them for member
  // actions like rsvp_to_event, and the admin shell nudges them here.
  // (A blanket isAdmin redirect used to live here; it made re-consent after
  // a privacy version bump impossible for admins.)
  const state = await loadOnboardingState(supabase, user.id);

  return (
    <div
      className={`${display.variable} dark relative min-h-screen bg-background text-foreground`}
    >
      {/* Same ambient field the member surfaces float on. Onboarding used to
          render a flat background, which is why its cards read as grey slabs
          while every other surface in the app reads as glass. */}
      <div aria-hidden className="ambient-field" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Same bound and padding as <main> so the wordmark sits flush with
            the step title below it. */}
        <header className="py-5">
          <div className="mx-auto flex w-full max-w-[38rem] items-center justify-between px-5">
            <Link
              href="/"
              className="rounded-md text-[15px] font-bold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              progsu
            </Link>
            <StepIndicator nextStep={state.nextStep} />
          </div>
        </header>

        {env.ONBOARDING_TEST_MODE ? (
          <div className="mx-auto w-full max-w-[38rem] px-5 pt-1">
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
              Test mode is on — forms are pre-filled with dummy values, no
              emails are sent, and the verification code is always{" "}
              <span className="font-mono font-semibold">000000</span>.
            </div>
          </div>
        ) : null}

        {/* One column for every step, matching the header above it, so the
            title lands in the same place on each screen instead of each page
            picking its own width. */}
        <main className="mx-auto w-full max-w-[38rem] flex-1 px-5 pb-24 pt-4 sm:pb-16 sm:pt-8">
          {children}
        </main>
      </div>
    </div>
  );
}
