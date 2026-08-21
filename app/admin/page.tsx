import Link from "next/link";
import { ArrowUpRight, Download, ScrollText, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Stats = {
  total: number;
  verified: number;
  unverified: number;
  withResume: number;
  openToRecruiters: number;
  pendingDomains: number;
};

async function loadStats(): Promise<Stats> {
  const admin = createAdminClient();

  const [totalQ, verifiedQ, unverifiedQ, resumeQ, openQ, pendingDomainsQ] =
    await Promise.all([
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
      admin
        .from("domain_requests")
        .select("*", { count: "exact", head: true }),
    ]);

  return {
    total: totalQ.count ?? 0,
    verified: verifiedQ.count ?? 0,
    unverified: unverifiedQ.count ?? 0,
    withResume: resumeQ.count ?? 0,
    openToRecruiters: openQ.count ?? 0,
    pendingDomains: pendingDomainsQ.count ?? 0,
  };
}

export default async function AdminHomePage() {
  const stats = await loadStats();
  const verifiedPct =
    stats.total === 0 ? 0 : Math.round((stats.verified / stats.total) * 100);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Member counts at a glance. Recruiter-eligible uses the export gate
          (see Export).
        </p>
      </header>

      {/* Hero: the one number this view leads with, plus the verified share
          as a meter (accent fill on a lighter step of the same hue). */}
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-96 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Members
            </p>
            <p className="mt-1 text-5xl font-semibold tracking-tight text-foreground">
              {stats.total}
            </p>
          </div>
          <div className="w-full max-w-xs">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Verified students</span>
              <span className="font-medium text-foreground">
                {stats.verified} · {verifiedPct}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
              <div
                aria-hidden
                className="h-full rounded-full bg-primary"
                style={{ width: `${verifiedPct}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="With resume" value={stats.withResume} />
        <StatTile label="Open to recruiters" value={stats.openToRecruiters} />
        <StatTile
          label="Unverified"
          value={stats.unverified}
          href="/admin/members?verified=no"
          warn={stats.unverified > 0}
        />
        <StatTile
          label="Domain requests"
          value={stats.pendingDomains}
          href="/admin/domain-requests"
          warn={stats.pendingDomains > 0}
        />
      </div>

      {/* Everything below is small/rarely-touched enough that it doesn't
          earn permanent nav real estate — reachable from here instead of
          the sidebar (see admin-nav.tsx). */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <LinkTile label="Export" icon={Download} href="/admin/export" />
        <LinkTile label="Audit log" icon={ScrollText} href="/admin/audit" />
        <LinkTile label="Settings" icon={Settings} href="/admin/settings" />
      </div>
    </div>
  );
}

function LinkTile({
  label,
  icon: Icon,
  href,
}: {
  label: string;
  icon: LucideIcon;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-black/20"
    >
      <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
        <Icon size={15} strokeWidth={1.75} className="text-muted-foreground" aria-hidden />
        {label}
      </span>
      <ArrowUpRight
        size={14}
        strokeWidth={2}
        aria-hidden
        className="shrink-0 text-muted-foreground/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
      />
    </Link>
  );
}

function StatTile({
  label,
  value,
  href,
  warn,
}: {
  label: string;
  value: number;
  href?: string;
  warn?: boolean;
}) {
  const body = (
    <div
      className={
        "group relative h-full rounded-xl border p-4 transition-all duration-200 " +
        (warn
          ? "border-amber-400/40 bg-amber-400/10 hover:border-amber-400/60"
          : "border-border/70 bg-card " +
            (href ? "hover:border-primary/40" : "")) +
        (href ? " hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20" : "")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={
            "text-xs font-semibold uppercase tracking-wide " +
            (warn ? "text-amber-300/80" : "text-muted-foreground")
          }
        >
          {label}
        </p>
        {href ? (
          <ArrowUpRight
            size={14}
            strokeWidth={2}
            aria-hidden
            className={
              "shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 " +
              (warn ? "text-amber-300/70" : "text-muted-foreground/50")
            }
          />
        ) : null}
      </div>
      <p
        className={
          "mt-1.5 text-3xl font-semibold tracking-tight " +
          (warn ? "text-amber-200" : "text-foreground")
        }
      >
        {value}
      </p>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }
  return body;
}
