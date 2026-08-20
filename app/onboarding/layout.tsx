import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadOnboardingState } from "@/lib/auth/onboarding";
import { StepIndicator } from "./_components/step-indicator";
import { OnbBackdrop } from "./_components/shell";

import "./onboarding.css";

export const dynamic = "force-dynamic";

type Props = {
  children: React.ReactNode;
};

// COMPOSITION CONTRACT for step pages:
// This layout renders ONLY the backdrop + floating header (wordmark +
// StepIndicator) on a viewport-height root; <main> is a bare h-full host.
// Each step renders its own <OnbSection> (from ./_components/shell) as its
// outermost element — the section owns the 38rem column, the top offset, the
// bottom clearance for the fixed OnbActionBar, and scrolling. Steps that
// should occupy exactly one viewport pass fill; inside the section, wrap the
// revealed content in <OnbSurface> and keep <OnbActionBar> a sibling of it.
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
    // Light theme on purpose: no "dark" class here. The `onb` class scopes
    // every rule in onboarding.css to this route.
    <div
      className={`onb relative h-dvh overflow-hidden bg-background text-foreground`}
    >
      <OnbBackdrop />

      {/* Floating header, folk-style: content scrolls under it inside each
          step's OnbSection (whose pt-28 clears it on load). */}
      <header className="absolute inset-x-5 top-5 z-20 flex items-start justify-between sm:inset-x-6">
        <Link
          href="/"
          className="flex h-12 items-center rounded-md text-[15px] font-bold tracking-tight text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          progsu
        </Link>
        <div className="flex h-12 items-center">
          <StepIndicator nextStep={state.nextStep} />
        </div>
      </header>

      {env.ONBOARDING_TEST_MODE ? (
        <div className="absolute inset-x-0 top-[4.25rem] z-20 mx-auto w-full max-w-[38rem] px-5">
          <div className="rounded-[14px] border border-[hsl(var(--primary)/0.25)] bg-[hsl(var(--primary)/0.06)] px-4 py-2.5 text-center text-xs text-[hsl(var(--primary))]">
            test mode is on — forms come pre-filled, no emails go out, and the
            code is always <span className="font-mono font-semibold">000000</span>
            .
          </div>
        </div>
      ) : null}

      {/* Bare host: steps bring their own <OnbSection>. overflow-y-auto is a
          safety net for any step not yet migrated to the section wrapper. */}
      <main className="relative z-10 h-full w-full overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
