import { notFound } from "next/navigation";

import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// Standalone shell for the public guest ticket (2026-08-21 guest-ticket
// decision). Three deliberate differences from /events:
//
//   1. No auth work and no member chrome. This page is reached from an email
//      by someone with no account, standing at a door. A header with
//      sign-in/nudge bars would be noise on the one surface where the QR is
//      the entire point.
//   2. Fixed dark, like /login, rather than cookie-themed. There is no
//      session to hold a theme preference, and a QR reads best on a dark page
//      with a white plate under it. That means no ThemeShell, so the ambient
//      field is rendered here directly (DESIGN.md §1: .glass without the field
//      behind it collapses into a flat lighter card).
//   3. Still behind FEATURE_EVENTS. The flag is the events kill switch, and a
//      ticket is an events surface — killing the feature has to kill this too,
//      before any DB work runs.
export default function TicketsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!env.FEATURE_EVENTS) notFound();

  return (
    <div className="dark relative min-h-screen bg-background text-foreground">
      <div aria-hidden className="ambient-field" />
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        {children}
      </main>
    </div>
  );
}
