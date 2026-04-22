import { notFound } from "next/navigation";

import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AdminEventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Kill switch per plan §14.5. When FEATURE_EVENTS is off we render 404 for
  // everyone — including admins — so the route doesn't leak through. The
  // parent /admin layout has already gated on is_admin.
  if (!env.FEATURE_EVENTS) notFound();
  return <>{children}</>;
}
