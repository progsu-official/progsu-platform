import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Stats = {
  total: number;
  verified: number;
  withResume: number;
  openToRecruiters: number;
  recruiterEligible: number;
};

async function loadStats(): Promise<Stats> {
  const admin = createAdminClient();

  const [totalQ, verifiedQ, resumeQ, openQ, eligibleQ] = await Promise.all([
    admin.from("profiles").select("*", { count: "exact", head: true }),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("student_email_verified", true),
    admin
      .from("resumes")
      .select("user_id", { count: "exact", head: true })
      .eq("is_current", true),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("open_to_recruiters", true),
    // Recruiter-eligible: verified + open_to_recruiters + not archived + has current resume
    // + accepted current version of recruiter_resume_sharing. We compute this via the
    // dedicated helper in Task 15; for now return 0 as a placeholder.
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("student_email_verified", true)
      .eq("open_to_recruiters", true)
      .eq("is_archived", false),
  ]);

  return {
    total: totalQ.count ?? 0,
    verified: verifiedQ.count ?? 0,
    withResume: resumeQ.count ?? 0,
    openToRecruiters: openQ.count ?? 0,
    // Without the consent join this is an overcount — the real figure lives in Task 15.
    recruiterEligible: eligibleQ.count ?? 0,
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Members" value={stats.total} />
        <StatCard label="Verified" value={stats.verified} />
        <StatCard label="With resume" value={stats.withResume} />
        <StatCard label="Open to recruiters" value={stats.openToRecruiters} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
    </div>
  );
}
