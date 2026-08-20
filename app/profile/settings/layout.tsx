import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { env } from "@/lib/env";

import { SettingsNav } from "./settings-nav";

export const dynamic = "force-dynamic";

// Auth, onboarding gating, theme, and the member header all come from
// app/profile/layout.tsx. This only adds the section rail.
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <Link
        href="/profile"
        className="mb-5 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
        Back to profile
      </Link>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[12rem_1fr] lg:gap-10">
        <SettingsNav showVisibility={env.FEATURE_MEMBER_DIRECTORY} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
