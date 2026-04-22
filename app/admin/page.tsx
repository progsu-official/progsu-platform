import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Stats = {
  total: number;
  verified: number;
  unverified: number;
  withResume: number;
  openToRecruiters: number;
};

async function loadStats(): Promise<Stats> {
  const admin = createAdminClient();

  const [totalQ, verifiedQ, unverifiedQ, resumeQ, openQ] = await Promise.all([
    admin.from("profiles").select("*", { count: "exact", head: true }),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("student_email_verified", true),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("student_email_verified", false),
    admin
      .from("resumes")
      .select("user_id", { count: "exact", head: true })
      .eq("is_current", true),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("open_to_recruiters", true),
  ]);

  return {
    total: totalQ.count ?? 0,
    verified: verifiedQ.count ?? 0,
    unverified: unverifiedQ.count ?? 0,
    withResume: resumeQ.count ?? 0,
    openToRecruiters: openQ.count ?? 0,
  };
}

export default async function AdminHomePage() {
  const stats = await loadStats();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Member counts at a glance. Recruiter-eligible uses the export gate (see
          Export).
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Members" value={stats.total} />
        <StatCard label="Verified" value={stats.verified} />
        <StatCard
          label="Unverified"
          value={stats.unverified}
          href="/admin/members?verified=no"
          emphasis={stats.unverified > 0 ? "warn" : undefined}
        />
        <StatCard label="With resume" value={stats.withResume} />
        <StatCard label="Open to recruiters" value={stats.openToRecruiters} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  emphasis,
}: {
  label: string;
  value: number;
  href?: string;
  emphasis?: "warn";
}) {
  const body = (
    <div
      className={
        "rounded-md border p-4 transition-colors " +
        (emphasis === "warn"
          ? "border-amber-500/40 bg-amber-50 dark:bg-amber-500/10"
          : "")
      }
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block hover:opacity-90">
        {body}
      </a>
    );
  }
  return body;
}
