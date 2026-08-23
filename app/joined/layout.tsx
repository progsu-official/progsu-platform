import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "@/lib/env";
import { OnbBackdrop } from "@/app/onboarding/_components/shell";

import "@/app/onboarding/onboarding.css";

export const dynamic = "force-dynamic";

// Deliberately borrows the onboarding funnel's chrome (docs/16-guest-conversion
// §3.2). A guest who just RSVP'd lands here and sees the shell members see —
// the message being "you are already in the funnel", not "here is an upsell".
// Unlike app/onboarding/layout.tsx this does NO auth work: the claim token in
// the path is the only credential, exactly as on /tickets/[token].
//
// Flag posture per CLAUDE.md rule #6: this is a route-edge kill switch, checked
// before anything else runs. Guest RSVP cannot happen with events off, so a
// token can never be minted while this is false.
export default async function WelcomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!env.FEATURE_EVENTS) notFound();

  return (
    <div className="onb relative h-dvh overflow-hidden bg-background text-foreground">
      <OnbBackdrop />

      <header className="absolute inset-x-5 top-5 z-20 flex items-start justify-between sm:inset-x-6">
        <Link
          href="/"
          className="flex h-12 items-center rounded-md text-[15px] font-bold tracking-tight text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          progsu
        </Link>
      </header>

      <main className="relative z-10 h-full w-full overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
