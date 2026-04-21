import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

import { ManualVerifyToggle } from "./manual-verify-toggle";
import { ResumeHistory } from "./resume-history";

export const dynamic = "force-dynamic";

export default async function AdminMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select(
      "id, first_name, last_name, preferred_name, google_email, student_email, student_email_verified, student_email_verified_at, verification_method, school, major, minor, class_standing, grad_year, grad_term, interested_roles, linkedin_url, github_url, portfolio_url, phone_number, open_to_recruiters, is_admin, is_archived, archived_at, profile_completed, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!profile) notFound();

  const [{ data: resumes }, { data: consents }, { data: audit }, { data: versions }] =
    await Promise.all([
      admin
        .from("resumes")
        .select("id, file_name, file_size, status, is_current, uploaded_at, deleted_at")
        .eq("user_id", id)
        .order("uploaded_at", { ascending: false }),
      admin
        .from("consents")
        .select("id, consent_type, accepted, version, accepted_at, ip_address")
        .eq("user_id", id)
        .order("accepted_at", { ascending: false })
        .limit(50),
      admin
        .from("audit_log")
        .select("id, action, actor_user_id, metadata, created_at")
        .or(`actor_user_id.eq.${id},target_user_id.eq.${id}`)
        .order("created_at", { ascending: false })
        .limit(30),
      admin.from("consent_versions").select("consent_type, version"),
    ]);

  const versionMap = new Map<string, string>();
  for (const v of versions ?? []) {
    versionMap.set(v.consent_type as string, v.version as string);
  }

  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted-foreground">
        <Link href="/admin/members" className="hover:underline">
          ← All members
        </Link>
      </nav>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile.first_name} {profile.last_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {profile.student_email ?? profile.google_email}
            {profile.student_email_verified ? (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Verified ({profile.verification_method ?? "unknown"})
              </span>
            ) : (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                Unverified
              </span>
            )}
          </p>
        </div>
        <ManualVerifyToggle
          userId={profile.id as string}
          verified={!!profile.student_email_verified}
        />
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="md:col-span-1 space-y-4">
          <Card title="Profile">
            <Row label="Name">
              {profile.first_name} {profile.last_name}
              {profile.preferred_name ? ` (${profile.preferred_name})` : null}
            </Row>
            <Row label="Google email">{profile.google_email}</Row>
            <Row label="Student email">{profile.student_email ?? "—"}</Row>
            <Row label="Phone">{profile.phone_number ?? "—"}</Row>
            <Row label="School">{profile.school ?? "—"}</Row>
            <Row label="Major / Minor">
              {profile.major ?? "—"}
              {profile.minor ? ` / ${profile.minor}` : ""}
            </Row>
            <Row label="Class">{profile.class_standing ?? "—"}</Row>
            <Row label="Graduates">{profile.grad_term ?? "—"}</Row>
            <Row label="Interested roles">
              <span className="text-xs">
                {(profile.interested_roles ?? []).join(", ") || "—"}
              </span>
            </Row>
            <Row label="LinkedIn">
              {profile.linkedin_url ? (
                <a
                  href={profile.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  link
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="GitHub">
              {profile.github_url ? (
                <a
                  href={profile.github_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  link
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Open to recruiters">
              {profile.open_to_recruiters ? "Yes" : "No"}
            </Row>
            <Row label="Archived">
              {profile.is_archived ? "Yes" : "No"}
            </Row>
          </Card>
        </section>

        <section className="space-y-4 md:col-span-2">
          <Card title="Resumes">
            <ResumeHistory
              resumes={(resumes ?? []).map((r) => ({
                id: r.id as string,
                file_name: r.file_name as string,
                file_size: r.file_size as number,
                status: r.status as string,
                is_current: r.is_current as boolean,
                uploaded_at: r.uploaded_at as string,
                deleted_at: r.deleted_at as string | null,
              }))}
            />
          </Card>

          <Card title="Consents">
            <div className="space-y-1 text-sm">
              {(consents ?? []).map((c) => (
                <div key={c.id as string} className="flex justify-between gap-2 border-b py-1 last:border-none">
                  <span className="font-mono text-xs">{c.consent_type}</span>
                  <span className="text-xs">
                    {c.accepted ? "✓ accepted" : "✗ declined"} · v{c.version} ·{" "}
                    {new Date(c.accepted_at as string).toLocaleDateString()}
                    {versionMap.get(c.consent_type as string) !== c.version
                      ? " · stale"
                      : ""}
                  </span>
                </div>
              ))}
              {(!consents || consents.length === 0) ? (
                <p className="text-muted-foreground">No consent rows.</p>
              ) : null}
            </div>
          </Card>

          <Card title="Recent activity">
            <div className="space-y-1 text-sm">
              {(audit ?? []).map((a) => (
                <div key={a.id as string} className="flex justify-between gap-2 border-b py-1 last:border-none text-xs">
                  <span className="font-mono">{a.action}</span>
                  <span className="text-muted-foreground">
                    {new Date(a.created_at as string).toLocaleString()}
                  </span>
                </div>
              ))}
              {(!audit || audit.length === 0) ? (
                <p className="text-muted-foreground text-xs">No recent events.</p>
              ) : null}
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-4">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}
