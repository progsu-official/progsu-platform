import type { Metadata } from "next";

import { env } from "@/lib/env";

import "./welcome.css";

import { Nav } from "./_components/nav";
import { HeroScene } from "./_components/hero-scene";
import { HowItWorks } from "./_components/how-it-works";
import { EventsCheckin } from "./_components/events-checkin";
import { ConsentDemo } from "./_components/consent-demo";
import { FinalCta } from "./_components/final-cta";
import { SiteFooter } from "./_components/site-footer";

// Public marketing page, no per-request auth data -- unlike the
// dashboard/admin/events/members surfaces, this one doesn't need
// `dynamic = "force-dynamic"` and is left to render statically.

export const metadata: Metadata = {
  title: "progsu: events worth showing up for",
  description:
    "Join the GSU builders community. One login, a profile that grows with every event you attend.",
};

export default function WelcomePage() {
  return (
    <div className="welcome-root">
      <Nav showEvents={env.FEATURE_EVENTS} />
      <HeroScene />
      <HowItWorks />
      <EventsCheckin />
      <ConsentDemo />
      <FinalCta showEvents={env.FEATURE_EVENTS} />
      <SiteFooter showEvents={env.FEATURE_EVENTS} showMembers={env.FEATURE_MEMBER_DIRECTORY} />
    </div>
  );
}
