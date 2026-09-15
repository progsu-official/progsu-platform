import { notFound } from "next/navigation";

import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AdminSmsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Route-edge kill switch, same as events. The parent /admin layout has
  // already 404'd non-admins.
  if (!env.FEATURE_SMS) notFound();
  return <>{children}</>;
}
