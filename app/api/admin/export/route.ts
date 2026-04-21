import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { csvRow } from "@/lib/csv";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// Admin-only recruiter CSV download. Shares the recruiter_eligible_members view with
// the preview count. D2 column set: includes google_email, student_email, phone_number.

type EligibleRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  google_email: string;
  student_email: string | null;
  phone_number: string | null;
  school: string | null;
  major: string | null;
  minor: string | null;
  class_standing: string | null;
  grad_year: number | null;
  grad_term: string | null;
  interested_roles: string[] | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  current_resume_id: string | null;
  resume_file_name: string | null;
  resume_storage_path: string | null;
  resume_uploaded_at: string | null;
};

const RESUME_SIGNED_URL_SECONDS = 15 * 60;

export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: isAdminResult } = await supabase.rpc("is_admin", {
    p_user_id: user.id,
  });
  if (isAdminResult !== true) {
    return new NextResponse("not found", { status: 404 });
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("recruiter_eligible_members")
    .select("*")
    .returns<EligibleRow[]>();
  if (error) {
    return new NextResponse(`error: ${error.message}`, { status: 500 });
  }

  const exportId = randomUUID();
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");

  // Write an audit row BEFORE streaming so the audit exists even if the client
  // aborts mid-download.
  await supabase.rpc("write_audit", {
    p_action: "admin_export_recruiter_csv",
    p_actor: user.id,
    p_target: null,
    p_metadata: {
      export_id: exportId,
      row_count: rows.length,
    },
  });
  log.info("admin recruiter CSV exported", {
    action: "admin_export_recruiter_csv",
    user_id: user.id,
    export_id: exportId,
    row_count: rows.length,
    ok: true,
  });

  // Mint signed URLs for each current resume. We do this up front (not streaming)
  // because createSignedUrl is an HTTP round-trip and the response goes out as one body.
  const signed = new Map<string, string>();
  if (rows.length > 0) {
    const paths = rows
      .map((r) => r.resume_storage_path)
      .filter((p): p is string => typeof p === "string");
    if (paths.length > 0) {
      const { data: signedList } = await admin.storage
        .from("resumes")
        .createSignedUrls(paths, RESUME_SIGNED_URL_SECONDS);
      for (const s of signedList ?? []) {
        if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
      }
    }
  }

  const header = [
    "export_id",
    "first_name",
    "last_name",
    "preferred_name",
    "google_email",
    "student_email",
    "phone_number",
    "school",
    "major",
    "minor",
    "class_standing",
    "grad_year",
    "grad_term",
    "interested_roles",
    "linkedin_url",
    "github_url",
    "portfolio_url",
    "resume_file_name",
    "resume_uploaded_at",
    "resume_signed_url",
    "resume_signed_url_expires_at",
  ];

  const signedExpiresAt = new Date(
    now.getTime() + RESUME_SIGNED_URL_SECONDS * 1000
  ).toISOString();

  const readmeLines = [
    `# Progsu recruiter CSV`,
    `# Export ID: ${exportId}`,
    `# Exported: ${now.toISOString()}`,
    `# Rows: ${rows.length}`,
    `# Resume URLs expire at: ${signedExpiresAt} (${RESUME_SIGNED_URL_SECONDS / 60} minutes after export)`,
    `# Reuse: this data is shared under Progsu's recruiter data agreement. Do not`,
    `# redistribute or sell. Users can withdraw consent at any time; regenerate the`,
    `# export before each outreach.`,
  ].map((l) => `# ${l}`).join("\n");

  const body =
    readmeLines +
    "\n" +
    csvRow(header) +
    "\n" +
    rows
      .map((r) =>
        csvRow([
          exportId,
          r.first_name,
          r.last_name,
          r.preferred_name,
          r.google_email,
          r.student_email,
          r.phone_number,
          r.school,
          r.major,
          r.minor,
          r.class_standing,
          r.grad_year,
          r.grad_term,
          (r.interested_roles ?? []).join(";"),
          r.linkedin_url,
          r.github_url,
          r.portfolio_url,
          r.resume_file_name,
          r.resume_uploaded_at,
          r.resume_storage_path ? signed.get(r.resume_storage_path) ?? "" : "",
          signedExpiresAt,
        ])
      )
      .join("\n") +
    "\n";

  const filename = `progsu-recruiter-${stamp}-${exportId.slice(0, 8)}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-export-id": exportId,
    },
  });
}
