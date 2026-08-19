import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { loadOnboardingState } from "@/lib/auth/onboarding";
import { StepIndicator } from "./_components/step-indicator";

export const dynamic = "force-dynamic";

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
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-[15px] font-bold tracking-tight">
            progsu
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-10">
        <StepIndicator nextStep={state.nextStep} />
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
