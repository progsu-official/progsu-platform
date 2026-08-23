import Link from "next/link";
import { notFound } from "next/navigation";

import { OnbBackdrop } from "@/app/onboarding/_components/shell";

import "@/app/onboarding/onboarding.css";
import { ScreenNav } from "./screen-nav";

export const dynamic = "force-dynamic";

// A flip-book of every funnel screen, rendered from dummy props with no auth,
// no session, and no database. Built because the alternative — signing in a
// throwaway account and completing a real RSVP to reach screen four — makes
// looking at screen four cost a minute and leave rows behind.
//
// These render the SAME components production renders. Only the props are
// fabricated, so what you see here is what ships. Submitting a form still
// calls its real server action and will fail without a session; the actions
// return errors rather than throwing, so that surfaces as the inline error
// state, which is worth seeing too.
export default function DevScreensLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hard gate on NODE_ENV, matching /api/dev-login. No env var can turn this
  // on in a deployment.
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="onb relative min-h-dvh bg-background text-foreground">
      <OnbBackdrop />

      <header className="absolute inset-x-5 top-5 z-30 flex items-center justify-between gap-4 sm:inset-x-6">
        <Link
          href="/dev/screens"
          className="flex h-12 items-center rounded-md text-[15px] font-bold tracking-tight text-foreground transition-colors hover:text-muted-foreground"
        >
          progsu <span className="ml-2 font-normal text-muted-foreground">screens</span>
        </Link>
      </header>

      {/* pb clears the fixed screen-nav pill, which otherwise sits on top of
          whatever the last control on a tall step is. */}
      <main className="relative z-10 min-h-dvh w-full pb-24">{children}</main>

      <ScreenNav />
    </div>
  );
}
