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

  const state = await loadOnboardingState(supabase, user.id);
  if (state.isAdmin) redirect("/admin");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Progsu
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
