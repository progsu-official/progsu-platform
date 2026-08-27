import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { INTERESTED_ROLES, INTERESTED_ROLE_LABELS } from "@/lib/enums/roles";

export const dynamic = "force-dynamic";

type SearchParams = {
  view?: string; // "members" | "legacy"
  q?: string;
  school?: string;
  grad_year?: string;
  role?: string | string[];
  verified?: string; // "yes" | "no"
  has_resume?: string; // "yes" | "no"
  open?: string; // "yes" | "no"
  archived?: string; // "yes" | "no"
  claimed?: string; // "unclaimed" | "claimed" | "all" (legacy view only)
  sms?: string; // "yes" | "no" | "unknown" (legacy view only)
  page?: string;
  legacy?: string; // "yes" to show the unclaimed historical-import archive
  lpage?: string;
};

const PAGE_SIZE = 25;
const MAX_PAGE = 1000;

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const admin = createAdminClient();
  const view = params.view === "legacy" ? "legacy" : "members";

  // Tab counts: cheap head-only counts, fetched regardless of which tab is
  // active so the toggle itself always shows real numbers.
  const [{ count: membersCount }, { count: legacyUnclaimedCount }] =
    await Promise.all([
      admin.from("profiles").select("*", { count: "exact", head: true }),
      admin
        .from("legacy_members")
        .select("*", { count: "exact", head: true })
        .is("claimed_at", null),
    ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        </div>
      </header>

      <nav className="flex gap-1 border-b" aria-label="Members view">
        <Link
          href="/admin/members"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            view === "members"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Members ({membersCount ?? 0})
        </Link>
        <Link
          href="/admin/members?view=legacy"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            view === "legacy"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Legacy ({legacyUnclaimedCount ?? 0} not signed up)
        </Link>
      </nav>

      {view === "legacy" ? (
        <LegacySection admin={admin} params={params} />
      ) : (
        <MembersSection admin={admin} params={params} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members tab: real profiles.
// ---------------------------------------------------------------------------

async function MembersSection({
  admin,
  params,
}: {
  admin: ReturnType<typeof createAdminClient>;
  params: SearchParams;
}) {
  const q = (params.q ?? "").trim();
  const school = (params.school ?? "").trim();
  const gradYear = Number.parseInt(params.grad_year ?? "", 10);
  const roles = asArray(params.role).filter((r) =>
    (INTERESTED_ROLES as readonly string[]).includes(r)
  );
  const verified = params.verified;
  const hasResume = params.has_resume;
  const open = params.open;
  const archived = params.archived;
  const page = Math.min(
    Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1),
    MAX_PAGE
  );
  const showLegacy = params.legacy === "yes";
  const legacyPage = Math.min(
    Math.max(1, Number.parseInt(params.lpage ?? "1", 10) || 1),
    MAX_PAGE
  );

  let builder = admin
    .from("profiles")
    .select(
      `id, first_name, last_name, school, major, class_standing, grad_year, grad_term, student_email, student_email_verified, pending_domain_name, open_to_recruiters, is_archived, is_admin, interested_roles,
       resumes!inner(id)`,
      { count: "exact" }
    );

  if (q) {
    const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
    builder = builder.or(
      `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,student_email.ilike.%${escaped}%`
    );
  }
  if (school) builder = builder.eq("school", school);
  if (!Number.isNaN(gradYear)) builder = builder.eq("grad_year", gradYear);
  if (roles.length > 0) builder = builder.overlaps("interested_roles", roles);
  if (verified === "yes") builder = builder.eq("student_email_verified", true);
  if (verified === "no") builder = builder.eq("student_email_verified", false);
  if (open === "yes") builder = builder.eq("open_to_recruiters", true);
  if (open === "no") builder = builder.eq("open_to_recruiters", false);
  if (archived === "yes") builder = builder.eq("is_archived", true);
  else if (archived !== "all") builder = builder.eq("is_archived", false);

  // `resumes!inner(id)` joins + filters: we need to re-shape depending on has_resume.
  // Simplest approach: drop the inner join unless has_resume is explicitly set to "yes".
  // We'll re-build with a non-inner select below when has_resume !== "yes".

  if (hasResume !== "yes") {
    builder = admin
      .from("profiles")
      .select(
        `id, first_name, last_name, school, major, class_standing, grad_year, grad_term, student_email, student_email_verified, pending_domain_name, open_to_recruiters, is_archived, is_admin, interested_roles`,
        { count: "exact" }
      );

    if (q) {
      const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
      builder = builder.or(
        `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,student_email.ilike.%${escaped}%`
      );
    }
    if (school) builder = builder.eq("school", school);
    if (!Number.isNaN(gradYear)) builder = builder.eq("grad_year", gradYear);
    if (roles.length > 0) builder = builder.overlaps("interested_roles", roles);
    if (verified === "yes") builder = builder.eq("student_email_verified", true);
    if (verified === "no") builder = builder.eq("student_email_verified", false);
    if (open === "yes") builder = builder.eq("open_to_recruiters", true);
    if (open === "no") builder = builder.eq("open_to_recruiters", false);
    if (archived === "yes") builder = builder.eq("is_archived", true);
    else if (archived !== "all") builder = builder.eq("is_archived", false);
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data: rows, count, error } = await builder
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return <p className="text-sm text-destructive">Query error: {error.message}</p>;
  }

  // Only fetch current-resume info for the row ids we got back; saves a big join.
  const ids = (rows ?? []).map((r) => r.id);
  const currentResumeByUser = new Map<string, { id: string; file_name: string }>();
  if (ids.length > 0) {
    const { data: resumes } = await admin
      .from("resumes")
      .select("id, user_id, file_name")
      .in("user_id", ids)
      .eq("is_current", true);
    for (const r of resumes ?? []) {
      currentResumeByUser.set(r.user_id as string, {
        id: r.id as string,
        file_name: r.file_name as string,
      });
    }
  }

  // School options from allowlist for the filter select.
  const { data: domains } = await admin
    .from("school_domains")
    .select("school_name")
    .eq("is_active", true)
    .order("school_name");
  const schools = Array.from(
    new Set((domains ?? []).map((d) => d.school_name as string))
  );

  const totalPages = Math.min(
    Math.ceil((count ?? 0) / PAGE_SIZE) || 1,
    MAX_PAGE
  );

  // Historical Luma import (see scripts/import-legacy-members.ts). Only the
  // unclaimed rows are worth surfacing here — claimed ones already show up
  // above as real profiles. Kept as a separate table/query rather than
  // merged into the paginated list above: the two sources have unrelated
  // filters/columns, and a real profiles row already wins once claimed.
  let legacyRows: Array<{
    id: string;
    full_name: string | null;
    personal_email: string | null;
    campus_email: string | null;
    phone_number: string | null;
    source: string;
    imported_at: string;
  }> = [];
  let legacyCount = 0;
  if (showLegacy) {
    const lFrom = (legacyPage - 1) * PAGE_SIZE;
    const lTo = lFrom + PAGE_SIZE - 1;
    let legacyBuilder = admin
      .from("legacy_members")
      .select(
        "id, full_name, personal_email, campus_email, phone_number, source, imported_at",
        { count: "exact" }
      )
      .is("claimed_profile_id", null);
    if (q) {
      const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
      legacyBuilder = legacyBuilder.or(
        `full_name.ilike.%${escaped}%,personal_email.ilike.%${escaped}%,campus_email.ilike.%${escaped}%`
      );
    }
    const {
      data: legacyData,
      count: legacyTotal,
      error: legacyError,
    } = await legacyBuilder
      .order("imported_at", { ascending: false })
      .range(lFrom, lTo);
    if (!legacyError) {
      legacyRows = legacyData ?? [];
      legacyCount = legacyTotal ?? 0;
    }
  }
  const legacyTotalPages = Math.min(
    Math.ceil(legacyCount / PAGE_SIZE) || 1,
    MAX_PAGE
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {count ?? 0} result{count === 1 ? "" : "s"}
      </p>

      <form className="flex flex-wrap gap-2 rounded-md border bg-muted/10 p-3 text-xs">
        <input
          name="q"
          defaultValue={q}
          placeholder="Name or email…"
          className="flex-1 rounded-md border border-input bg-background px-2 py-1"
        />
        <select
          name="school"
          defaultValue={school}
          className="rounded-md border border-input bg-background px-2 py-1"
        >
          <option value="">All schools</option>
          {schools.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          name="grad_year"
          defaultValue={Number.isNaN(gradYear) ? "" : String(gradYear)}
          placeholder="Grad year"
          inputMode="numeric"
          className="w-24 rounded-md border border-input bg-background px-2 py-1"
        />
        <select
          name="verified"
          defaultValue={verified ?? ""}
          className="rounded-md border border-input bg-background px-2 py-1"
        >
          <option value="">Verified?</option>
          <option value="yes">Verified only</option>
          <option value="no">Unverified only</option>
        </select>
        <select
          name="has_resume"
          defaultValue={hasResume ?? ""}
          className="rounded-md border border-input bg-background px-2 py-1"
        >
          <option value="">Resume?</option>
          <option value="yes">Has resume</option>
          <option value="no">No resume</option>
        </select>
        <select
          name="open"
          defaultValue={open ?? ""}
          className="rounded-md border border-input bg-background px-2 py-1"
        >
          <option value="">Open to recruiters?</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
        <select
          name="archived"
          defaultValue={archived ?? ""}
          className="rounded-md border border-input bg-background px-2 py-1"
        >
          <option value="">Hide archived</option>
          <option value="yes">Archived only</option>
          <option value="all">Include archived</option>
        </select>
        <details className="rounded-md border border-input bg-background px-2 py-1">
          <summary className="cursor-pointer select-none">
            Roles ({roles.length})
          </summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {INTERESTED_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1 rounded-full border px-2 py-0.5">
                <input
                  type="checkbox"
                  name="role"
                  value={r}
                  defaultChecked={roles.includes(r)}
                />
                {INTERESTED_ROLE_LABELS[r]}
              </label>
            ))}
          </div>
        </details>
        <label className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1">
          <input
            type="checkbox"
            name="legacy"
            value="yes"
            defaultChecked={showLegacy}
          />
          Show historical import (unclaimed)
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
        >
          Apply
        </button>
        <Link
          href="/admin/members"
          className="rounded-md border border-input px-3 py-1 text-xs font-medium"
        >
          Reset
        </Link>
      </form>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">School</th>
              <th className="px-3 py-2 font-medium">Grad</th>
              <th className="px-3 py-2 font-medium">Major</th>
              <th className="px-3 py-2 font-medium">Resume</th>
              <th className="px-3 py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(rows ?? []).map((r) => {
              const res = currentResumeByUser.get(r.id as string);
              return (
                <tr key={r.id as string} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/members/${r.id}`}
                      className="text-primary hover:underline"
                    >
                      {r.first_name} {r.last_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.student_email ?? "—"}
                    {r.student_email_verified ? (
                      <span
                        title="Verified via OTP"
                        className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                      >
                        ✓ Verified
                      </span>
                    ) : r.pending_domain_name ? (
                      <span
                        title={`${r.pending_domain_name} isn't in the allowlist yet — admin needs to add it.`}
                        className="ml-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400 cursor-help"
                      >
                        Pending school
                      </span>
                    ) : r.student_email ? (
                      <span
                        title="Student email pending OTP verification"
                        className="ml-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                      >
                        Unverified
                      </span>
                    ) : (
                      <span
                        title="No student email provided"
                        className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        No email
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.school ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.grad_term ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.major ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {res ? (
                      <span className="truncate" title={res.file_name}>
                        {res.file_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.open_to_recruiters ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        OTR
                      </span>
                    ) : null}
                    {r.is_admin ? (
                      <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                        Admin
                      </span>
                    ) : null}
                    {r.is_archived ? (
                      <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                        Archived
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} searchParams={params} />

      {showLegacy ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">
            Historical import, unclaimed ({legacyCount})
          </h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Imported</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {legacyRows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2">{r.full_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.campus_email ?? r.personal_email ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.phone_number ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.source}</td>
                    <td className="px-3 py-2 text-xs">
                      {new Date(r.imported_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={legacyPage}
            totalPages={legacyTotalPages}
            searchParams={params}
            paramName="lpage"
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy tab: pre-signup staging data (Luma/Sheets/Tally import, 2026-08-16).
// Defaults to unclaimed rows, people who haven't signed up yet, since a
// claimed row already shows up under its real profile in the Members tab.
// ---------------------------------------------------------------------------

type LegacyRow = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  personal_email: string | null;
  campus_email: string | null;
  phone_number: string | null;
  sms_interest: boolean | null;
  source: string;
  source_detail: string | null;
  imported_at: string;
  claimed_at: string | null;
  claimed_profile_id: string | null;
};

async function LegacySection({
  admin,
  params,
}: {
  admin: ReturnType<typeof createAdminClient>;
  params: SearchParams;
}) {
  const q = (params.q ?? "").trim();
  const claimed = params.claimed ?? "unclaimed";
  const sms = params.sms;
  const page = Math.min(
    Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1),
    MAX_PAGE
  );

  let builder = admin
    .from("legacy_members")
    .select(
      "id, full_name, first_name, last_name, personal_email, campus_email, phone_number, sms_interest, source, source_detail, imported_at, claimed_at, claimed_profile_id",
      { count: "exact" }
    );

  if (q) {
    const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
    builder = builder.or(
      `full_name.ilike.%${escaped}%,personal_email.ilike.%${escaped}%,campus_email.ilike.%${escaped}%`
    );
  }
  if (claimed === "unclaimed") builder = builder.is("claimed_at", null);
  else if (claimed === "claimed") builder = builder.not("claimed_at", "is", null);
  if (sms === "yes") builder = builder.eq("sms_interest", true);
  else if (sms === "no") builder = builder.eq("sms_interest", false);
  else if (sms === "unknown") builder = builder.is("sms_interest", null);

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data: rows, count, error } = await builder
    .order("imported_at", { ascending: false })
    .range(from, to);

  if (error) {
    return <p className="text-sm text-destructive">Query error: {error.message}</p>;
  }

  const totalPages = Math.min(
    Math.ceil((count ?? 0) / PAGE_SIZE) || 1,
    MAX_PAGE
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {count ?? 0} result{count === 1 ? "" : "s"}. Pre-signup data imported
        from the old master sheet and Luma exports, matched to a real profile
        automatically on first Google sign-in.
      </p>

      <form className="flex flex-wrap gap-2 rounded-md border bg-muted/10 p-3 text-xs">
        <input type="hidden" name="view" value="legacy" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Name or email…"
          className="flex-1 rounded-md border border-input bg-background px-2 py-1"
        />
        <select
          name="claimed"
          defaultValue={claimed}
          className="rounded-md border border-input bg-background px-2 py-1"
        >
          <option value="unclaimed">Not signed up yet</option>
          <option value="claimed">Already signed up</option>
          <option value="all">All</option>
        </select>
        <select
          name="sms"
          defaultValue={sms ?? ""}
          className="rounded-md border border-input bg-background px-2 py-1"
        >
          <option value="">SMS interest?</option>
          <option value="yes">Said yes</option>
          <option value="no">Said no</option>
          <option value="unknown">Never answered</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
        >
          Apply
        </button>
        <Link
          href="/admin/members?view=legacy"
          className="rounded-md border border-input px-3 py-1 text-xs font-medium"
        >
          Reset
        </Link>
      </form>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Personal email</th>
              <th className="px-3 py-2 font-medium">Campus email</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">SMS interest</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {((rows ?? []) as LegacyRow[]).map((r) => (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-3 py-2">
                  {r.full_name || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.personal_email ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.campus_email ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.phone_number ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.sms_interest === true
                    ? "Yes"
                    : r.sms_interest === false
                      ? "No"
                      : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground" title={r.source_detail ?? undefined}>
                  {r.source}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.claimed_profile_id ? (
                    <Link
                      href={`/admin/members/${r.claimed_profile_id}`}
                      className="text-primary hover:underline"
                    >
                      Signed up
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Not signed up</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        searchParams={{ ...params, view: "legacy" }}
      />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  searchParams,
  paramName = "page",
}: {
  page: number;
  totalPages: number;
  searchParams: SearchParams;
  paramName?: string;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === paramName) continue;
    if (Array.isArray(v)) for (const x of v) qs.append(k, x);
    else if (v != null) qs.append(k, v);
  }
  const link = (p: number) => {
    const u = new URLSearchParams(qs);
    u.set(paramName, String(p));
    return `?${u.toString()}`;
  };
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <a
            href={link(page - 1)}
            className="rounded-md border border-input px-3 py-1 hover:bg-accent/10"
          >
            Prev
          </a>
        ) : null}
        {page < totalPages ? (
          <a
            href={link(page + 1)}
            className="rounded-md border border-input px-3 py-1 hover:bg-accent/10"
          >
            Next
          </a>
        ) : null}
      </div>
    </div>
  );
}
