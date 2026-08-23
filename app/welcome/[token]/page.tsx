import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getGuestClaimContext } from "@/lib/actions/events";

import { WelcomeFlow } from "./welcome-flow";

export const dynamic = "force-dynamic";

// Same posture as the guest ticket page: the token in the path is a bearer
// credential, so keep it out of search indexes.
export const metadata: Metadata = {
  title: "You're in",
  robots: { index: false, follow: false },
};

export default async function WelcomePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const context = await getGuestClaimContext(token);

  // Unknown, malformed, and revoked tokens are indistinguishable to the
  // visitor on purpose.
  if (!context) notFound();

  return <WelcomeFlow token={token} context={context} />;
}
