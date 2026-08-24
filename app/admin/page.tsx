import { createClient } from "@/lib/supabase/server";

import {
  OverviewDashboard,
  type Analytics,
} from "./overview-dashboard";

export const dynamic = "force-dynamic";

// Fetch-and-hand-off, the same split app/admin/events/[id] uses for its
// analytics tab: this file owns the query, overview-dashboard.tsx owns the
// rendering and takes the payload as a prop.
export default async function AdminHomePage() {

  // User-context client, not createAdminClient(): the RPC gates on
  // is_admin(auth.uid()) itself, which is the pattern every other admin RPC
  // on this codebase follows.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_platform_analytics", {
    p_weeks: 26,
    p_months: 12,
  });

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader />
        <p className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">
          Couldn&apos;t load platform analytics
          {error?.message ? `: ${error.message}` : "."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader generatedAt={(data as unknown as Analytics).generated_at} />
      <OverviewDashboard data={data as unknown as Analytics} />
    </div>
  );
}

function PageHeader({ generatedAt }: { generatedAt?: string }) {
  return (
    <header>
      <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How the platform is doing. Every number is live — nothing here is
        cached.
        {generatedAt ? (
          <>
            {" "}
            <span className="tabular-nums">
              Read at {new Date(generatedAt).toLocaleTimeString()}.
            </span>
          </>
        ) : null}
      </p>
    </header>
  );
}
