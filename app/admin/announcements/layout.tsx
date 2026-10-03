import { notFound } from "next/navigation";

import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// Announcements exist for the iOS app; FEATURE_MOBILE_API off closes the page.
export default function Layout({ children }: { children: React.ReactNode }) {
  if (!env.FEATURE_MOBILE_API) notFound();
  return children;
}
