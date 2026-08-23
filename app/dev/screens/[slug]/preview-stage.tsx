"use client";

import { useRouter } from "next/navigation";

import { PreviewProvider } from "@/app/onboarding/_components/preview";

// Maps the paths the real forms navigate to onto the gallery's own routes, so
// filling one in and pressing Continue walks to the next screen instead of
// leaving for a page that would bounce to /login.
//
// Anything not listed falls through to the index rather than escaping the
// gallery — a form that grows a new destination shows up as a trip to the
// index, which is noticeable, instead of a redirect loop, which is not.
const ROUTE_MAP: Record<string, string> = {
  "/onboarding/verify-email": "verify-email",
  "/onboarding/profile": "profile",
  "/onboarding/links": "links",
  "/onboarding/resume": "resume",
  "/onboarding/consent": "consent",
  "/onboarding/done": "done",
  // ?play=1 so the two beats actually run. Landing on joined-landed directly
  // freezes the first beat for inspection, which is right when you clicked it
  // from the index and wrong when you just submitted the RSVP form.
  "/joined": "joined-landed?play=1",
  // Where the funnel finally lets someone out. There is no profile page in
  // the gallery, so the walkthrough ends where it began.
  "/profile": "",
};

export function PreviewStage({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <PreviewProvider
      value={{
        advance: (path) => {
          const slug = ROUTE_MAP[path];
          router.push(slug ? `/dev/screens/${slug}` : "/dev/screens");
        },
      }}
    >
      {children}
    </PreviewProvider>
  );
}
