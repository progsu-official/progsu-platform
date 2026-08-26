import { notFound } from "next/navigation";

import { env } from "@/lib/env";
import { listAllReferralLinks } from "@/lib/actions/referrals";

import { CampaignsDashboard } from "./campaigns";

// Campaign links across every event.
//
// The per-event Links tab answers "how did this event's campaigns do". This
// page answers the question that actually decides where next semester's
// posters go — "which channel works for us" — which no single event can.
//
// Flag-gated at the route edge like every other feature surface: off is a
// notFound() before any work runs, so the page does not exist rather than
// existing and being empty.

export const dynamic = "force-dynamic";

export const metadata = { title: "Campaign links · Progsu Admin" };

const DAY_RANGES = [7, 30, 90] as const;

export default async function AdminLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  if (!env.FEATURE_REFERRAL_LINKS) notFound();

  const { days: rawDays } = await searchParams;
  const parsed = Number(rawDays);
  const days = (DAY_RANGES as readonly number[]).includes(parsed) ? parsed : 30;

  const result = await listAllReferralLinks(days);

  return (
    <CampaignsDashboard
      data={result.ok ? result.data : null}
      error={result.ok ? null : result.error.message}
      origin={env.NEXT_PUBLIC_SITE_URL}
      days={days}
      dayRanges={[...DAY_RANGES]}
    />
  );
}
