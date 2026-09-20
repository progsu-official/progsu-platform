import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { csvRow } from "@/lib/csv";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// Admin-only per-event CSV download. One row per registrant across all three
// sources (member RSVPs, member walk-ins, guest RSVPs, historical import) —
// admin_event_export_for does the union so this handler only has to shape CSV.
//
// User-context client, not the service-role one: admin_event_export_for is
// SECURITY DEFINER and writes its audit row off auth.uid(), same as
// admin_event_analytics_for (see app/admin/events/[id]/page.tsx).

type ExportRow = {
  event_id: string;
  event_title: string;
  event_slug: string;
  event_status: string;
  event_starts_at: string;
  event_ends_at: string;
  event_location: string | null;
  event_capacity: number | null;
  attendee_type: string;
  profile_id: string | null;
  full_name: string | null;
  preferred_name: string | null;
  google_email: string | null;
  school_email: string | null;
  phone_number: string | null;
  school: string | null;
  major: string | null;
  minor: string | null;
  class_standing: string | null;
  grad_year: number | null;
  grad_term: string | null;
  interested_roles: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  discord_username: string | null;
  rsvp_status: string | null;
  rsvp_at: string | null;
  checked_in: boolean | null;
  checked_in_at: string | null;
  checkin_method: string | null;
};

const HEADER = [
  "event_title",
  "event_date",
  "event_status",
  "event_location",
  "event_capacity",
  "attendee_type",
  "full_name",
  "preferred_name",
  "school_email",
  "google_email",
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
  "discord_username",
  "rsvp_status",
  "rsvp_at",
  "checked_in",
  "checked_in_at",
  "checkin_method",
  "profile_id",
] as const;

// Spreadsheet-safe slug for the filename; the title is user-authored and
// routinely contains "$", "/" and spaces (e.g. "$1000 Fall Kickoff Carnival").
function slugForFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "event"
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: isAdminResult } = await supabase.rpc("is_admin", {
    p_user_id: user.id,
  });
  if (isAdminResult !== true) {
    // notFound(), not 403 — don't leak admin surface existence (CLAUDE.md #7).
    return new NextResponse("not found", { status: 404 });
  }

  const { data, error } = await supabase.rpc("admin_event_export_for", {
    p_event_id: id,
  });
  if (error) {
    log.error("admin event CSV export failed", {
      action: "admin_export_event_csv",
      user_id: user.id,
      event_id: id,
      ok: false,
      error: error.message,
    });
    // P0002 is "event not found" from the RPC.
    const status = error.message.includes("event not found") ? 404 : 500;
    return new NextResponse(`error: ${error.message}`, { status });
  }

  const rows = (data ?? []) as ExportRow[];
  const exportId = randomUUID();
  const now = new Date();

  log.info("admin event CSV exported", {
    action: "admin_export_event_csv",
    user_id: user.id,
    event_id: id,
    export_id: exportId,
    row_count: rows.length,
    ok: true,
  });

  const title = rows[0]?.event_title ?? "event";
  const startsAt = rows[0]?.event_starts_at ?? null;

  const body =
    csvRow([...HEADER]) +
    "\n" +
    rows
      .map((r) =>
        csvRow([
          r.event_title,
          r.event_starts_at,
          r.event_status,
          r.event_location,
          r.event_capacity,
          r.attendee_type,
          r.full_name,
          r.preferred_name,
          r.school_email,
          r.google_email,
          r.phone_number,
          r.school,
          r.major,
          r.minor,
          r.class_standing,
          r.grad_year,
          r.grad_term,
          r.interested_roles,
          r.linkedin_url,
          r.github_url,
          r.portfolio_url,
          r.discord_username,
          r.rsvp_status,
          r.rsvp_at,
          r.checked_in ? "yes" : "no",
          r.checked_in_at,
          r.checkin_method,
          r.profile_id,
        ])
      )
      .join("\n") +
    "\n";

  const stamp = (startsAt ? new Date(startsAt) : now)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const filename = `progsu-${slugForFilename(title)}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-export-id": exportId,
      "x-row-count": String(rows.length),
    },
  });
}
